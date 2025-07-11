const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// ✅ Helper function to read JSON file safely with async/await
function readData(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, data) => {
      if (err) return reject(err);
      try {
        const parsed = JSON.parse(data || '[]');
        resolve(parsed);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}


// Paths
const productsPath = path.join(__dirname, '../models/products.json');
const ordersPath = path.join(__dirname, '../models/orders.json');
const sellersPath = path.join(__dirname, '../models/sellers.json');
const messagesPath = path.join(__dirname, '../models/messages.json');

// Homepage
router.get('/', (req, res) => {
  try {
    const allProducts = JSON.parse(fs.readFileSync(productsPath, 'utf-8') || '[]');
    const approved = allProducts.filter(p => p.approved && (p.quantity ?? 1) > 0);
    const latest = approved.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);

    res.render('customer/index', {
      products: latest,
      user: req.session.user || null
    });
  } catch (err) {
    console.error('Home load error:', err);
    res.status(500).send('Homepage error');
  }
});

// Show all approved products
router.get('/products', (req, res) => {
  try {
    const allProducts = JSON.parse(fs.readFileSync(productsPath, 'utf-8') || '[]');
    const approved = allProducts.filter(p => p.approved && (p.quantity ?? 1) > 0);
    res.render('customer/products', { products: approved });
  } catch (err) {
    console.error('Product list error:', err);
    res.status(500).send('Products error');
  }
});

// Product Detail Page
router.get('/product/:id', (req, res) => {
  try {
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8') || '[]');
    const product = products.find(p => p.id === req.params.id && p.approved);

    if (!product) {
      return res.status(404).render('error', { message: 'Product not found or not approved.' });
    }

    const related = products.filter(p =>
      p.sellerId === product.sellerId &&
      p.id !== product.id &&
      p.approved &&
      (p.quantity ?? 1) > 0
    );

    const allMessages = fs.existsSync(messagesPath)
      ? JSON.parse(fs.readFileSync(messagesPath, 'utf-8') || '[]')
      : [];

    const productMessages = allMessages.filter(
      msg => msg.productId === product.id && msg.sellerId === product.sellerId
    );

    res.render('customer/product-detail', {
      product,
      related,
      user: req.session.user || null,
      messages: productMessages,
      success: req.query.success || null  // ✅ this adds success message
    });

  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).send('Product detail error');
  }
});

// Add to Cart


// View Cart
router.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  res.render('customer/cart', { cart, total });
});

// Remove from Cart
router.post('/cart/remove/:id', (req, res) => {
  if (!req.session.cart) return res.redirect('/cart');
  req.session.cart = req.session.cart.filter(item => item.id !== req.params.id);
  res.redirect('/cart');
});

// Place Order
router.post('/place-order', (req, res) => {
  try {
    const { name, phone, address, location, productId, paymentMethod } = req.body;

    let products = JSON.parse(fs.readFileSync(productsPath, 'utf-8') || '[]');
    const productIndex = products.findIndex(p => p.id === productId && p.approved);

    if (productIndex === -1) {
      return res.status(400).send('Invalid product.');
    }

    const product = products[productIndex];
    const quantity = product.quantity ?? 1;

    if (quantity <= 0) {
      return res.status(400).send('This product is out of stock.');
    }

    const orderId = uuidv4();
    const tax = paymentMethod === 'cod' ? Math.round(product.price * 0.02 * 100) / 100 : 0;

    const order = {
      id: orderId,
      productId,
      productName: product.name,
      productImage: product.images?.[0] || product.image,
      price: product.price,
      customerName: name,
      customerPhone: phone,
      customerAddress: address,
      customerLocation: location,
      paymentMethod,
      total: product.price + tax,
      tax,
      status: 'pending',
      sellerId: product.sellerId,
      createdAt: new Date().toISOString()
    };

    products[productIndex].quantity = quantity - 1;
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));

    const existingOrders = fs.existsSync(ordersPath)
      ? JSON.parse(fs.readFileSync(ordersPath, 'utf-8') || '[]')
      : [];

    existingOrders.push(order);
    fs.writeFileSync(ordersPath, JSON.stringify(existingOrders, null, 2));

    res.render('customer/order-success', { order });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).send('Order failed');
  }
});

// ✅ Save message from customer to seller
router.post('/customer/message', (req, res) => {
  const { sellerId, productId, message } = req.body;

  if (!req.session.user || !req.session.user.name) {
    return res.redirect('/auth/customer/login');
  }

  try {
    const messagesPath = path.join(__dirname, '../models/messages.json');
    const allMessages = fs.existsSync(messagesPath)
      ? JSON.parse(fs.readFileSync(messagesPath, 'utf-8') || '[]')
      : [];

    const newMessage = {
      id: uuidv4(),
      sellerId,
      productId,
      from: req.session.user.name,
      fromEmail: req.session.user.email,
      message: message.trim(),
      reply: null,
      createdAt: new Date().toISOString()
    };

    allMessages.push(newMessage);
    fs.writeFileSync(messagesPath, JSON.stringify(allMessages, null, 2));

    res.redirect(`/product/${productId}?success=Message sent`);
  } catch (err) {
    console.error('❌ Message send error:', err);
    res.status(500).send('Failed to send message.');
  }
});
// ✅ Checkout page (GET)
router.get('/checkout/:productId', (req, res) => {
  const productId = req.params.productId;
  const qty = parseInt(req.query.qty) || 1;

  try {
    const allProducts = JSON.parse(fs.readFileSync(productsPath, 'utf-8') || '[]');
    const product = allProducts.find(p => p.id === productId && p.approved);

    if (!product || product.quantity < qty) {
      return res.status(400).send('Invalid product or not enough quantity');
    }

    res.render('customer/checkout', {
      product,
      quantity: qty
    });
  } catch (err) {
    console.error('Checkout view error:', err);
    res.status(500).send('Checkout failed');
  }
});
// ... your previous routes here ...

// ✅ Place Order (POST)
router.post('/checkout', async (req, res) => {
  try {
    const { name, phone, address, location, paymentMethod, items } = req.body;

    const products = await readData(productsPath);
    const orders = fs.existsSync(ordersPath)
      ? JSON.parse(fs.readFileSync(ordersPath, 'utf-8') || '[]')
      : [];

    let totalPrice = 0;
    const parsedItems = Array.isArray(items) ? items.map(i => JSON.parse(i)) : [];

    const newOrders = [];

    for (let item of parsedItems) {
      const productIndex = products.findIndex(p => p.id === item.id);
      if (productIndex === -1 || products[productIndex].quantity < item.quantity) {
        return res.status(400).send(`Invalid product or not enough quantity for ${item.name}`);
      }

      const product = products[productIndex];
      const orderId = uuidv4();
      const tax = paymentMethod === 'cod'
        ? Math.round(product.price * item.quantity * 0.02 * 100) / 100
        : 0;

      const order = {
        id: orderId,
        productId: product.id,
        productName: product.name,
        productImage: product.images?.[0] || product.image,
        price: product.price,
        quantity: item.quantity,
        customerName: name,
        customerPhone: phone,
        customerAddress: address,
        customerLocation: location,
        paymentMethod,
        total: product.price * item.quantity + tax,
        tax,
        status: 'pending',
        sellerId: product.sellerId,
        createdAt: new Date().toISOString()
      };

      totalPrice += order.total;
      newOrders.push(order);

      // reduce product quantity
      products[productIndex].quantity -= item.quantity;
    }

    // save new orders
    orders.push(...newOrders);
    fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));

    // Clear cart
    req.session.cart = [];

    res.render('customer/order-success', { orders: newOrders, total: totalPrice });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).send('Checkout failed');
  }
});

router.post('/add-to-cart/:id', async (req, res) => {
  const productId = req.params.id;
  const quantity = parseInt(req.body.qty) || 1;

  const products = await readData(productsPath);
  const product = products.find(p => p.id === productId && p.approved && !p.blocked);

  if (!product || quantity > product.quantity) {
    return res.redirect('/products/' + productId + '?error=Invalid product or quantity');
  }

  if (!req.session.cart) req.session.cart = [];

  const existingItem = req.session.cart.find(item => item.id === productId);

  if (existingItem) {
    existingItem.quantity += quantity;
    if (existingItem.quantity > product.quantity) {
      existingItem.quantity = product.quantity;
    }
  } else {
    req.session.cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] || '/images/no-image.png',
      quantity
    });
  }

  res.redirect('/cart');
});
// routes/customer.js
router.get('/checkout', (req, res) => {
  const cart = req.session.cart || [];

  if (!cart.length) {
    return res.redirect('/cart');
  }

  // Combine total quantity and one sample product for display
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const product = {
    id: 'multi',
    name: `${cart.length} item(s)`,
    price: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    sellerId: cart[0].sellerId || '',
  };

  res.render('customer/checkout', { cart, product, quantity });
});


// ✅ Final line
module.exports = router;



module.exports = router;
