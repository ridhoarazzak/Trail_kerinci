window.onerror = (m, s, l) => { const e = document.getElementById('legend'); if (e) e.textContent = m + ' @' + String(s).split('/').pop() + ':' + l; };
// Isi/ubah di sini sebelum dipublikasikan. Kontak yang kosong tidak ditampilkan.
self.FRESS_CONFIG = {
  // Nomor darurat nasional Indonesia.
  emergency: [
    { label: "Darurat umum", number: "112" },
    { label: "Basarnas (SAR)", number: "115" }
  ],
  // Contoh: { label: "Panitia / Medis FRESS", number: "08xxxxxxxxxx" }
  organizers: [],
  // Lapisan kontur (hasil gdal2tiles --xyz). Batas dari GeoTIFF contur_kerinci.tif (WGS84).
  contour: {
  file: "kontur_kerinci.png",
  opacity: 0.85,
  west: 101.19715887930619, east: 101.33594859070266,
  south: -1.7620013347658026, north: -1.60542498074377
},
  },
  // Naikkan setiap kali data jalur atau tile diubah agar HP peserta mengambil versi baru.
  dataVersion: "2026-10-17"
};
