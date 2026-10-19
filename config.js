// Isi/ubah di sini sebelum dipublikasikan. Kontak yang kosong tidak ditampilkan.
self.FRESS_CONFIG = {
  // Nomor darurat nasional Indonesia.
  emergency: [
    { label: "Darurat umum", number: "112" },
    { label: "Basarnas (SAR)", number: "115" }
  ],
  // Contoh: { label: "Panitia / Medis FRESS", number: "08xxxxxxxxxx" }
  organizers: [],
  // Jalur yang disembunyikan (cocokkan dengan nama jalur/titik). Kosongkan [] untuk menampilkan semua.
  hideRoutes: ["Blok E"],
  // Titik tambahan di luar data/routes.json. Posisi dibaca dari peta kertas 1:50.000 (2018), jadi hanya perkiraan.
  extraWaypoints: [
    { name: "Genangan Air (perkiraan)", route: "Jalur Bangunrejo", lat: -1.6511, lon: 101.2295 }
  ],
  // Lapisan kontur: satu PNG transparan (dari contur_kerinci.tif, WGS84, sudah dalam proyeksi Web Mercator).
  contour: {
    file: "kontur_kerinci.png",
    opacity: 0.85,
    west: 101.19715887930619, east: 101.33594859070266,
    south: -1.7620013347658026, north: -1.60542498074377
  },
  // Naikkan setiap kali data jalur atau berkas peta diubah agar HP peserta mengambil versi baru.
  dataVersion: "2026-10-19a"
};
