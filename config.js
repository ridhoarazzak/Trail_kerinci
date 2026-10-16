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
    dir: "tiles_kerinci",
    minZ: 10,
    maxZ: 16,
    opacity: 0.8,
    west: 101.1972, east: 101.3359, south: -1.7620, north: -1.6054
  },
  // Naikkan setiap kali data jalur atau tile diubah agar HP peserta mengambil versi baru.
  dataVersion: "2026-10-17"
};
