# DESIGN.md — Semantic Design System & Visual Specification
> **Aplikasi**: Sistem Manajemen Tugas  
> **Standar Arsitektur**: *High-End Agency Tier (Linear / Apple-Grade)*  
> **Filosofi**: *Anti-Slop, Tactile Haptic Depth, Ergonomic Productivity, WCAG 2.1 AA Compliant*

---

## 1. Visual Atmosphere & Aesthetic Dial
* **Atmosfer**: *Tactical Precision Minimalist*. Tenang, fungsional, berbobot perangkat fisik (*machined hardware*), bebas dari ornamen murahan dan gradasi AI ungu/neon klise.
* **Dial Pengaturan**:
  - **Density**: `7/10 (Productivity Balanced)` — Informasi tersaji padat terstruktur, mudah dipindai cepat tanpa terasa sesak.
  - **Variance**: `7/10 (Offset Asymmetric)` — Menolak layout simetris 3-kartu standar; memadukan bento grid fungsional dengan hierarki visual dinamis.
  - **Motion**: `6/10 (Fluid Haptic Springs)` — Animasi mekanis berbobot massa nyata (*cubic-bezier*), bukan linier atau transisi instan kaku.

---

## 2. Palet Warna & Semantic Design Tokens (Strict Zero-Slop Palette)

### Aturan Ketat:
- ❌ **BANNED**: Gradasi neon ungu/cyan ala template AI, drop shadow gelap pekat `rgba(0,0,0,0.5)`, pure black `#000000`.
- ✅ **ENFORCED**: Latar netral dalam (*deep slate / obsidian*), hairline border tipis, 1 aksen fungsional utama dengan saturasi terkalibrasi (<80%).

### 2.1 Mode Gelap (Dark Mode — Primary Productivity Canvas)
```css
:root[data-theme="dark"] {
  /* Surface Layers */
  --canvas-bg: #090d16;          /* Deepest Obsidian Slate */
  --surface-shell: #0f172a;      /* Outer Bezel (Navy Slate) */
  --surface-core: #182234;       /* Inner Core Container */
  --surface-elevated: #1e293b;   /* Modals, Dropdowns, Popovers */
  --surface-hover: #243247;      /* Interactive Hover State */

  /* Hairlines & Borders */
  --border-hairline: rgba(255, 255, 255, 0.08); /* 1px crisp separation */
  --border-subtle: rgba(255, 255, 255, 0.14);   /* Cards & Active Tabs */
  --border-focus: #3b82f6;                       /* High-contrast focus ring */

  /* Text & Typography */
  --text-primary: #f8fafc;       /* Pure Off-White (Contrast Ratio 15.8:1) */
  --text-secondary: #94a3b8;     /* Muted Cool Gray (Contrast Ratio 7.2:1) */
  --text-tertiary: #64748b;      /* Disabled / Placeholder */

  /* Functional Status Accents */
  --accent-primary: #3b82f6;     /* Vibrant Electric Slate Blue */
  --accent-primary-hover: #2563eb;
  --status-todo: #64748b;        /* Neutral Slate (To Do) */
  --status-in-progress: #f59e0b; /* Amber Gold (In Progress) */
  --status-done: #10b981;        /* Emerald Vivid (Done / Success) */
  --status-urgent: #f97316;      /* Tangerine Flame (< 24 Jam) */
  --status-overdue: #ef4444;     /* Crimson Red (Terlambat) */
}
```

### 2.2 Mode Terang (Light Mode — Crisp Clean Studio)
```css
:root[data-theme="light"] {
  --canvas-bg: #f8fafc;          /* Muted Studio White Canvas */
  --surface-shell: #ffffff;      /* Crisp Pure White Outer Shell */
  --surface-core: #f1f5f9;       /* Inner Structured Surface */
  --surface-elevated: #ffffff;   /* Floating Dialogs */
  --surface-hover: #e2e8f0;

  --border-hairline: rgba(15, 23, 42, 0.08);
  --border-subtle: rgba(15, 23, 42, 0.16);
  --border-focus: #2563eb;

  --text-primary: #0f172a;       /* Deep Midnight Black */
  --text-secondary: #475569;     /* Slate Neutral */
  --text-tertiary: #94a3b8;

  --accent-primary: #2563eb;
  --status-todo: #64748b;
  --status-in-progress: #d97706;
  --status-done: #059669;
  --status-urgent: #ea580c;
  --status-overdue: #dc2626;
}
```

---

## 3. Sistem Tipografi & Skala Hirarki

### Aturan Ketat Tipografi:
- ❌ **BANNED**: Font generic default `Arial`, `Roboto`, `Times New Roman`, atau `Inter` standar tanpa kurasi.
- ✅ **ENFORCED**: Pasangan Sans Modern + Monospace untuk presisi data:
  - **Sans Font**: `Plus Jakarta Sans` / `Geist Sans` (Geometris bersih, keterbacaan tinggi di layar kecil).
  - **Monospace Font**: `JetBrains Mono` / `Geist Mono` (Wajib untuk semua angka, tanggal, durasi waktu, ID tugas).

| Tingkat Hirarki | Ukuran | Line Height | Bobot | Tracking | Karakter / Pemakaian |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Headline H1** | `32px / 2.0rem` | `1.2` | Bold (700) | `-0.03em` | Judul Utama Workspace / Dashboard |
| **Section H2** | `20px / 1.25rem` | `1.3` | SemiBold (600) | `-0.02em` | Header Kolom Kanban, Judul Modul |
| **Card Title H3**| `15px / 0.937rem`| `1.4` | Medium (500) | `-0.01em` | Judul Kartu Tugas, Form Label Utama |
| **Body Standard**| `14px / 0.875rem`| `1.5` | Regular (400) | `0` | Deskripsi Tugas, Pesan Notifikasi |
| **Caption Mono** | `12px / 0.75rem` | `1.4` | Medium (500) | `+0.02em` | Tanggal Deadline, Jam, Assignee (`font-mono`) |
| **Micro Badge**  | `10px / 0.625rem`| `1.2` | Bold (700) | `+0.12em` | Tag Prioritas (`HIGH`, `MED`, `LOW`) |

---

## 4. Arsitektur Komponen Haptik (Haptic Component Mastery)

### 4.1 Double-Bezel Architecture (Doppelrand Container)
Kartu tugas dan modal tidak diletakkan secara datar, melainkan menggunakan arsitektur bertingkat concentric:
```html
<!-- Outer Shell -->
<div class="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-1.5 shadow-sm">
  <!-- Inner Core Content -->
  <div class="rounded-[calc(1rem-0.375rem)] bg-slate-800/80 p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
    <!-- Konten Kartu Tugas -->
  </div>
</div>
```

### 4.2 Button-in-Button Architecture (Primary CTA Island)
* **Desain**: Tombol utama berbentuk kapsul (`rounded-xl` atau `rounded-full`) dengan padding proporsional (`px-5 py-2.5`).
* **Nested Icon Pill**: Ikon panah (`↗`) atau tanda tambah (`+`) dibungkus dalam lingkaran kecil terpisah di sisi kanan dalam tombol.
* **Kinetic Hover Feedback**:
  ```css
  /* Physics Transition */
  .btn-primary {
    transition: all 400ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .btn-primary:active {
    transform: scale(0.98);
  }
  .btn-primary:hover .btn-icon-wrapper {
    transform: translate(2px, -2px) scale(1.05);
  }
  ```

### 4.3 State Button & Anti-Double-Click Protection
* Ketika tombol form diklik, status tombol **seketika dinonaktifkan** (`disabled = true`, `cursor-not-allowed`).
* Teks berganti menjadi *"Memproses..."* disertai animasi **Micro-Spinner SVG** yang halus.
* Mencegah pengiriman data ganda (*duplicate POST request*) ke Neon DB.

### 4.4 Status Badges & Pill Indicators
| Status | Background Token | Teks Token | Border Token | Ikon Indikator |
| :--- | :--- | :--- | :--- | :---: |
| **To Do** | `bg-slate-500/10` | `text-slate-400` | `border-slate-500/20` | Lingkaran Kosong (○) |
| **In Progress** | `bg-amber-500/10` | `text-amber-400` | `border-amber-500/20` | Lingkaran Berputar (◐) |
| **Done** | `bg-emerald-500/10` | `text-emerald-400`| `border-emerald-500/20`| Centang Tebal (✓) |
| **Urgent (<24h)**| `bg-orange-500/10` | `text-orange-400` | `border-orange-500/30`| Kilat / Jam (⚡) |
| **Overdue** | `bg-rose-500/10` | `text-rose-400` | `border-rose-500/30` | Segitiga Bahaya (⚠️) |

---

## 5. Tata Letak, Grid, & Pedoman Responsif (Mobile Ergonomics)

### 5.1 Standar Ruang & Batas Layar
- ❌ **DILARANG**: Menggunakan `h-screen` karena menyebabkan *viewport jumping* parah di browser mobile (iOS Safari / Android Chrome address bar).
- ✅ **WAJIB**: Menggunakan `min-h-[100dvh]` untuk seluruh kontainer layar penuh.
- **Ukuran Sentuh (*Touch Target*)**: Semua tombol, checkbox status, dan link memiliki area sentuh minimum **$44 \times 44\text{ px}$** untuk kenyamanan jempol di layar handphone.

### 5.2 Responsive Breakpoint Strategy
* **Desktop ($\ge 1024\text{px}$)**:
  - Sidebar tetap (*fixed collapsible sidebar*), lebar $260\text{px}$.
  - Main Workspace: Bento Grid statis, Kanban Board 3 kolom horizontal, Data Table lengkap.
* **Tablet ($768\text{px} - 1023\text{px}$)**:
  - Sidebar collapse menjadi ikon navigasi ringkas ($72\text{px}$).
  - Kanban Board mendukung *horizontal swipe* yang mulus.
* **Mobile ($< 768\text{px}$)**:
  - Sidebar diubah menjadi *Top Header Bar* dengan tombol profil dan notifikasi.
  - Kanban Board berganti menjadi tampilan **Tab Selector** (`[ To Do ] [ Berjalan ] [ Selesai ]`) atau Kartu Vertikal.
  - Ditambahkan **Floating Action Button (FAB)** di kanan bawah untuk tombol cepat `+ Buat Tugas`.
  - Navigasi utama menggunakan **Sticky Bottom Bar** ramah jempol.

---

## 6. Aksesibilitas (WCAG 2.1 AA Compliance)
1. **Rasio Kontras**: Teks putih/terang di atas background gelap memiliki rasio kontras minimum **$7:1$** (melebihi standar minimum WCAG AA $4.5:1$).
2. **Focus Ring Indikator**: Navigasi via keyboard (`Tab` & `Shift+Tab`) menampilkan *focus ring* berwarna biru kontras (`outline: 2px solid #3b82f6; outline-offset: 2px`).
3. **Screen Reader Semantic**: Seluruh tombol interaktif memiliki atribut `aria-label` yang jelas (contoh: `aria-label="Tandai tugas Laporan Selesai"`).
4. **Motion Preference**: Mendukung CSS query `@media (prefers-reduced-motion: reduce)` yang mematikan animasi transisi bagi pengguna dengan sensitivitas vestibular.
