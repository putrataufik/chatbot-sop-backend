// FILE: src/modules/sop-documents/docx-extractor.service.ts
// v4: DOCX → PDF → pdfplumber word-level spatial extraction

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { DOMParser } from '@xmldom/xmldom';
const AdmZip = require('adm-zip');

@Injectable()
export class DocxExtractorService {
  private readonly logger = new Logger(DocxExtractorService.name);

  async extract(fileBuffer: Buffer): Promise<string> {
    try {
      const result = await this.extractViaPdf(fileBuffer);
      if (result?.trim().length > 50) {
        this.logger.log(`[DOCX] PDF pipeline OK: ${result.length} chars`);
        return result;
      }
    } catch (e: any) {
      this.logger.warn(`[DOCX] PDF pipeline failed: ${e.message}`);
    }
    return this.extractOoxmlFallback(fileBuffer);
  }

  private async extractViaPdf(fileBuffer: Buffer): Promise<string> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sop-'));
    try {
      const docx = path.join(tmp, 'input.docx');
      const pdf = path.join(tmp, 'input.pdf');
      const out = path.join(tmp, 'output.txt');
      const script = path.join(tmp, 'extract.py');

      fs.writeFileSync(docx, fileBuffer);

      // ── Find soffice command ──
      const sofficeCmd = this.findSoffice();
      this.logger.log(`[DOCX] Using soffice: ${sofficeCmd}`);
      execSync(`${sofficeCmd} --headless --convert-to pdf --outdir "${tmp}" "${docx}"`, { timeout: 60000, stdio: 'pipe' });
      if (!fs.existsSync(pdf)) throw new Error('PDF not created');

      fs.writeFileSync(script, this.pythonScript(pdf, out));

      // ── Find python command ──
      const pythonCmd = this.findPython();
      this.logger.log(`[DOCX] Using python: ${pythonCmd}`);
      execSync(`${pythonCmd} "${script}"`, { timeout: 60000, stdio: 'pipe', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      if (!fs.existsSync(out)) throw new Error('Output not created');

      return fs.readFileSync(out, 'utf-8').replace(/\n{3,}/g, '\n\n').trim();
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }

  private pythonScript(pdfPath: string, outputPath: string): string {
    const p = pdfPath.replace(/\\/g, '\\\\');
    const o = outputPath.replace(/\\/g, '\\\\');
    return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import pdfplumber, re

ACTOR_HEADERS = ['TANGGUNG','PELAKSANA','PIC','PENANGGUNG','RESPONSIBLE','DEPARTEMEN']
ACTION_HEADERS = ['KEGIATAN','AKTIVITAS','URAIAN','PROSEDUR','DESKRIPSI','KETERANGAN','ACTIVITY','PROSES']
SKIP_WORDS = {'No.','KEGIATAN','TANGGUNG','JAWAB','URAIAN','AKTIVITAS','PELAKSANA','PIC','PROSEDUR','RESPONSIBLE','ACTIVITY','PROSES','KETERANGAN'}
ACTOR_PREFIXES = ['Manager','Mgr','Staf','Direktur','Dir','Kepala','Karyawan','Rumah']

# Known multi-word actor names (for wrapping detection)
KNOWN_ACTORS = [
    'Manager Langsung',
    'Mgr DYM', 'Mgr HRD',
    'Staf HRD',
    'Rumah Sakit',
    'Karyawan, Manager Langsung',
    'Manager Langsung, HRD, DirOps',
]

def main():
    with pdfplumber.open('${p}') as pdf:
        result = extract_doc(pdf)
    with open('${o}', 'w', encoding='utf-8') as f:
        f.write(result)

def extract_doc(pdf):
    sections = []
    col = None
    header_done = False
    step_pat = re.compile(r'^\\d+\\.\\d{1,2}$')

    for pg in pdf.pages:
        words = pg.extract_words(x_tolerance=3, y_tolerance=3)
        if not words: continue

        # ── Strategy 1: Word-level extraction (for step-numbered tables) ──
        new_col = detect_cols(words)
        if new_col: col = new_col

        if col:
            steps = extract_steps(words, col, pg, step_pat)
            if steps:
                if not header_done:
                    above = extract_above(words, col, pg, step_pat)
                    if above: sections.append(above)
                    sections.append('### Prosedur:')
                    sections.append('')
                    header_done = True
                for s in steps:
                    a = f" [{s['actor']}]" if s['actor'] else ''
                    sections.append(f"Langkah {s['num']}.{a} {s['action']}")
                continue

        # ── Strategy 2: Table-based extraction (for flowchart swim-lane) ──
        tables = pg.extract_tables()
        table_steps = extract_from_tables(tables)
        if table_steps:
            if not header_done:
                above_text = extract_text_above_tables(pg)
                if above_text: sections.append(above_text)
                sections.append('### Prosedur:')
                sections.append('')
                header_done = True
            for s in table_steps:
                a = f" [{s['actor']}]" if s['actor'] else ''
                sections.append(f"Langkah {s['num']}.{a} {s['action']}")
            continue

        # ── Fallback: plain text ──
        txt = pg.extract_text()
        if txt and txt.strip():
            sections.append(txt.strip())

    return '\\n'.join(sections).strip()


# ══════════════════════════════════════════════════════════════
# TABLE-BASED EXTRACTION (for flowchart swim-lane tables)
# ══════════════════════════════════════════════════════════════

FLOWCHART_NOISE = {'begin', 'end', 'mulai', 'selesai', 'start', 'stop', 'ya', 'tidak', 'yes', 'no'}

def extract_from_tables(tables):
    """Extract procedure steps from pdfplumber table rows."""
    if not tables:
        return []

    all_steps = []
    last_roles = None  # persist roles across tables for continuation

    for table in tables:
        if not table:
            continue

        # Detect column roles from header row
        header = [str(c).strip().lower() if c else '' for c in table[0]]
        roles = detect_table_col_roles(header)

        # Check if this is a continuation table (1 row, no recognizable header)
        is_continuation = len(table) == 1 and 'action' not in roles.values() and last_roles
        if is_continuation:
            roles = last_roles
            data_rows = table  # all rows are data (no header)
        elif len(table) < 2:
            continue
        else:
            data_rows = table[1:]  # skip header row

        if 'action' not in roles.values() and 'actor' not in roles.values():
            continue

        last_roles = roles  # save for continuation detection

        action_idx = next((k for k, v in roles.items() if v == 'action'), None)
        actor_idx = next((k for k, v in roles.items() if v == 'actor'), None)

        for row in data_rows:
            cells = [str(c).strip() if c else '' for c in row]

            action = cells[action_idx] if action_idx is not None and action_idx < len(cells) else ''
            actor = cells[actor_idx] if actor_idx is not None and actor_idx < len(cells) else ''

            action = re.sub(r'\\s+', ' ', action).strip()
            actor = re.sub(r'\\s+', ' ', actor).strip()
            action = re.sub(r'^[-•·]\\s*', '', action).strip()

            if not action and not actor:
                continue
            if action.lower() in FLOWCHART_NOISE:
                continue
            if not action and actor:
                continue

            all_steps.append({
                'num': str(len(all_steps) + 1),
                'action': action,
                'actor': actor,
            })

    return all_steps


def detect_table_col_roles(header):
    """Detect column roles from table header row."""
    roles = {}
    actor_kw = ['tanggung', 'jawab', 'pelaksana', 'pic', 'responsible']
    action_kw = ['keterangan', 'kegiatan', 'aktivitas', 'uraian', 'deskripsi', 'prosedur']
    flowchart_kw = ['proses', 'flowchart', 'diagram', 'alur']

    for i, h in enumerate(header):
        hl = h.lower().strip()
        if any(k in hl for k in actor_kw):
            roles[i] = 'actor'
        elif any(k in hl for k in action_kw):
            roles[i] = 'action'
        elif any(k in hl for k in flowchart_kw):
            roles[i] = 'flowchart'

    # If no action column found but there's a flowchart column,
    # check if there's a "keterangan" type column we missed
    if 'action' not in roles.values():
        # The last column is often the action/description
        for i in range(len(header) - 1, -1, -1):
            if i not in roles:
                roles[i] = 'action'
                break

    return roles


def extract_text_above_tables(page):
    """Extract text above the first table on the page."""
    tables = page.find_tables()
    if not tables:
        return page.extract_text() or ''

    first_table_top = tables[0].bbox[1]  # y-coordinate of table top
    try:
        crop = page.within_bbox((0, 0, page.width, first_table_top - 5))
        text = crop.extract_text()
        return text.strip() if text else ''
    except:
        return ''

def detect_cols(words):
    wmap = {}
    for w in words:
        k = w['text'].upper().strip()
        if k not in wmap: wmap[k] = w

    actor_x = None
    for h in ACTOR_HEADERS:
        if h in wmap:
            actor_x = wmap[h]['x0']
            break
    if not actor_x: return None

    action_x = 100
    for h in ACTION_HEADERS:
        if h in wmap:
            action_x = wmap[h]['x0']
            break

    return {'action_start': action_x, 'actor_start': actor_x - 15}

def extract_steps(words, col, page, step_pat):
    sw = sorted(
        [w for w in words if step_pat.match(w['text']) and w['x0'] < col['action_start']],
        key=lambda w: w['top']
    )
    if not sw: return []

    steps = []
    for i, s in enumerate(sw):
        y0 = s['top'] - 2
        y1 = sw[i+1]['top'] - 2 if i+1 < len(sw) else page.height - 40

        region = [
            w for w in words
            if w['top'] >= y0 and w['top'] < y1
            and w['text'].strip() not in SKIP_WORDS
            and w['text'].strip() not in ('','1','2','3','4','5')
            and not (w['text'] == s['text'] and abs(w['x0'] - s['x0']) < 5)
            and not (step_pat.match(w['text']) and w['x0'] < col['action_start'] and w['text'] != s['text'])
        ]

        ax = col['actor_start']
        aw = sorted([w for w in region if w['x0'] < ax], key=lambda w:(w['top'],w['x0']))
        rw = sorted([w for w in region if w['x0'] >= ax], key=lambda w:(w['top'],w['x0']))

        action = re.sub(r'\\s+', ' ', ' '.join(w['text'] for w in aw)).strip()
        actor = re.sub(r'\\s+', ' ', ' '.join(w['text'] for w in rw)).strip()

        # Dedup actor
        actor = dedup(actor)

        # Fix actor prefix leaked into action
        action, actor = fix_leak(action, actor)

        steps.append({'num': s['text'].rstrip('.'), 'action': action, 'actor': actor})

    return steps

def dedup(text):
    if not text: return text
    w = text.split()
    n = len(w)
    if n >= 2 and n % 2 == 0:
        h = n // 2
        if ' '.join(w[:h]) == ' '.join(w[h:]): return ' '.join(w[:h])
    return text

def fix_leak(action, actor):
    """
    Fix actor name parts that leaked into the action column due to text wrapping.

    Problem: Long actor names like "Karyawan, Manager Langsung" or
    "Manager Langsung, HRD, DirOps" wrap across the column boundary.
    pdfplumber splits at x-position, so "Manager" ends up in action
    and "Langsung, HRD, DirOps" in actor.

    Solution: Use regex to find known actor patterns in the combined text,
    then reconstruct action and actor properly.
    """
    if not action and not actor:
        return action, actor

    # Combine for pattern matching
    combined = (action + ' ' + actor).strip() if actor else action

    # Known actor patterns (ordered longest first for greedy matching)
    actor_patterns = [
        r'Manager\\s+Langsung,\\s*HRD,\\s*DirOps',
        r'Karyawan,\\s*Manager\\s+Langsung',
        r'Rumah\\s+Sakit,\\s*Psikolog',
        r'Manager\\s+Langsung',
        r'Mgr\\s+HRD,\\s*Staf\\s+HRD',
        r'Mgr\\s+DYM',
        r'Mgr\\s+HRD',
        r'Staf\\s+HRD',
        r'DirOps',
        r'Dirut',
    ]

    # Try to find an actor pattern in the combined text
    # The actor should be at or near the end of the combined text,
    # or at a position that makes sense (not in the middle of a sentence)
    best_match = None
    best_pos = -1

    for pat in actor_patterns:
        for m in re.finditer(pat, combined):
            # Prefer matches closer to the position where actor column starts
            # (i.e., roughly where the original actor text was)
            if m.start() > best_pos:
                # Make sure we're not matching actor names that are part of the procedure text
                # e.g., "mendiskusikannya dengan Mgr DYM" — here Mgr DYM is in the action
                before = combined[:m.start()].strip()
                if before.endswith(('dengan', 'oleh', 'kepada', 'dari', 'ke', 'bersama')):
                    continue  # This is a reference in the action text, not the actor
                best_match = m
                best_pos = m.start()

    if best_match and best_match.start() > 0:
        found_actor = best_match.group().strip()
        found_action = combined[:best_match.start()].strip()
        remaining = combined[best_match.end():].strip()

        # If there's remaining text after the actor, it might be more action text
        # that was on lines below the actor, or it could be additional actor info
        if remaining:
            # Check if remaining looks like actor continuation
            if remaining.startswith(',') or remaining[0:1].islower():
                found_actor = found_actor + ' ' + remaining
            else:
                found_action = found_action + ' ' + remaining

        return found_action, found_actor

    # No pattern found — try simple last-word check
    if action and actor:
        words = action.split()
        last = words[-1] if words else ''
        if last in ACTOR_PREFIXES:
            return ' '.join(words[:-1]), last + ' ' + actor

    return action, actor

def extract_above(words, col, page, step_pat):
    y = None
    for w in sorted(words, key=lambda w: w['top']):
        if step_pat.match(w['text']) and w['x0'] < col['action_start']:
            y = w['top'] - 30
            break
    if not y: return ''
    try:
        crop = page.within_bbox((0, 0, page.width, y))
        t = crop.extract_text()
        return t.strip() if t else ''
    except: return ''

if __name__ == '__main__':
    main()
`;
  }

  private extractOoxmlFallback(fileBuffer: Buffer): string {
    const zip = new AdmZip(fileBuffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) throw new BadRequestException('word/document.xml tidak ditemukan');
    const xml = entry.getData().toString('utf-8');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = this.firstByTag(doc as any, 'body');
    if (!body) return '';
    const lines: string[] = [];
    for (const node of this.children(body)) {
      if (node.localName === 'p') {
        const t = this.text(node).trim();
        if (t) lines.push(t);
      } else if (node.localName === 'tbl') {
        for (const row of this.childrenByTag(node, 'tr')) {
          const cells = this.childrenByTag(row, 'tc').map(c => this.text(c).trim()).filter(Boolean);
          if (cells.length) lines.push(cells.join(' | '));
        }
      }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMAND DETECTION (Windows / Linux / Mac)
  // ══════════════════════════════════════════════════════════════════════════

  private findSoffice(): string {
    // Windows: cari di lokasi umum
    const windowsPaths = [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files\\LibreOffice 24.8\\program\\soffice.exe',
      'C:\\Program Files\\LibreOffice 25.2\\program\\soffice.exe',
    ];

    for (const p of windowsPaths) {
      if (fs.existsSync(p)) {
        return `"${p}"`;
      }
    }

    // Coba via PATH (Linux/Mac, atau Windows jika sudah di-PATH)
    try {
      execSync('soffice --version', { stdio: 'pipe', timeout: 5000 });
      return 'soffice';
    } catch {}

    // Coba via PATH dengan nama alternatif
    try {
      execSync('libreoffice --version', { stdio: 'pipe', timeout: 5000 });
      return 'libreoffice';
    } catch {}

    throw new Error(
      'LibreOffice tidak ditemukan. Install LibreOffice dari https://www.libreoffice.org/download/ ' +
      'dan pastikan terinstall di "C:\\Program Files\\LibreOffice"'
    );
  }

  private findPython(): string {
    // Windows: python dulu (python3 ter-redirect ke Microsoft Store alias)
    // Linux/Mac: python3 dulu
    const order = process.platform === 'win32'
      ? ['python', 'python3']
      : ['python3', 'python'];

    for (const cmd of order) {
      try {
        const out = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 }).toString();
        if (out.includes('Python')) return cmd;
      } catch {}
    }

    throw new Error(
      'Python tidak ditemukan. Install Python dari https://www.python.org/downloads/ ' +
      '(centang "Add Python to PATH" saat install), lalu jalankan: pip install pdfplumber'
    );
  }

  private children(n: any): any[] {
    if (!n?.childNodes) return [];
    const o: any[] = [];
    for (let i = 0; i < n.childNodes.length; i++) { const c = n.childNodes.item(i); if (c?.nodeType === 1) o.push(c); }
    return o;
  }
  private childrenByTag(n: any, t: string): any[] { return this.children(n).filter(c => c.localName === t); }
  private firstByTag(n: any, t: string): any | null {
    if (!n?.childNodes) return null;
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes.item(i);
      if (c?.nodeType === 1) { if (c.localName === t) return c; const f = this.firstByTag(c, t); if (f) return f; }
    }
    return null;
  }
  private allByTag(n: any, t: string): any[] {
    const o: any[] = [];
    const w = (x: any) => { if (!x?.childNodes) return; for (let i = 0; i < x.childNodes.length; i++) { const c = x.childNodes.item(i); if (c?.nodeType !== 1) continue; if (c.localName === t) o.push(c); w(c); } };
    w(n); return o;
  }
  private text(el: any): string { return this.allByTag(el, 't').map(t => t.textContent ?? '').join(''); }
}