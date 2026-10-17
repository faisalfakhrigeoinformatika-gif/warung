const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Inisialisasi Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Menangani escape newline pada private key di environment variable
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- 1. PRODUK ---
// Tambah Produk
app.post('/api/products', async (req, res) => {
  try {
    const { name, price, stock } = req.body;
    const docRef = await db.collection('products').add({
      name,
      price: Number(price),
      stock: Number(stock),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: docRef.id, message: 'Produk berhasil ditambahkan' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lihat Daftar Produk
app.get('/api/products', async (req, res) => {
  try {
    const snapshot = await db.collection('products').get();
    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- 2. TRANSAKSI ---
// Catat Transaksi Penjualan & Kurangi Stok Otomatis
app.post('/api/transactions', async (req, res) => {
  try {
    const { items } = req.body; // Format: [{ productId, quantity }]
    let totalAmount = 0;
    const transactionDetails = [];

    await db.runTransaction(async (t) => {
      for (let item of items) {
        const productRef = db.collection('products').doc(item.productId);
        const productDoc = await t.get(productRef);
        
        if (!productDoc.exists) {
          throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan`);
        }

        const productData = productDoc.data();
        if (productData.stock < item.quantity) {
          throw new Error(`Stok tidak cukup untuk produk: ${productData.name}`);
        }

        const subtotal = productData.price * item.quantity;
        totalAmount += subtotal;

        // Kurangi stok
        t.update(productRef, { stock: productData.stock - item.quantity });

        transactionDetails.push({
          productId: item.productId,
          productName: productData.name,
          price: productData.price,
          quantity: item.quantity,
          subtotal
        });
      }

      // Simpan riwayat transaksi
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        items: transactionDetails,
        totalAmount,
        date: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.status(201).json({ message: 'Transaksi berhasil disimpan', totalAmount });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- 3. LAPORAN ---
// Lihat Laporan Penjualan
app.get('/api/reports', async (req, res) => {
  try {
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').get();
    const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Hitung total pendapatan keseluruhan
    const totalRevenue = transactions.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);

    res.json({
      totalTransactions: transactions.length,
      totalRevenue,
      transactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export untuk Vercel Serverless Function
module.exports = app;

// Jalankan server lokal jika tidak di Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}