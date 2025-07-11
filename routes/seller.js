const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');

const sellersPath = path.join(__dirname, '../models/sellers.json');
const productsPath = path.join(__dirname, '../models/products.json');
const ordersPath = path.join(__dirname, '../models/orders.json');
const messagesPath = path.join(__dirname, '../models/messages.json');
const adminMessagesPath = path.join(__dirname, '../models/adminMessages.json');

const readData = async (file, fallback = []) => {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data || '[]');
  } catch {
    return fallback;
  }
};

const writeData = async (file, data) => {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const isOlderThan24Hours = (dateString) => {
  const messageDate = new Date(dateString);
  const now = new Date();
  const diffInHours = (now - messageDate) / (1000 * 60 * 60);
  return diffInHours > 24;
};

const sendEmail = async (to, subject, text) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'sher87125@gmial.com',
      pass: 'your_app_password_here'
    }
  });

  await transporter.sendMail({
    from: 'sher87125@gmial.com',
    to,
    subject,
    text
  });
};

// Multer for image upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, '../public/images');
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'product-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images allowed'), false);
  }
});

const isSeller = async (req, res, next) => {
  if (!req.session?.seller) return res.redirect('/seller/login');
  const sellers = await readData(sellersPath);
  const seller = sellers.find(s => s.id === req.session.seller.id);
  if (!seller) return res.redirect('/seller/login?error=Seller not found');
  if (seller.blocked) return res.redirect('/seller/login?error=Account blocked');
  req.seller = seller;
  next();
};

// Dashboard Route - Updated to show both customer and admin messages
router.get('/dashboard', isSeller, async (req, res) => {
  const products = await readData(productsPath);
  let messages = await readData(messagesPath);
  let adminMessages = await readData(adminMessagesPath);
  
  // Filter out messages older than 24 hours
  messages = messages.filter(m => !isOlderThan24Hours(m.createdAt));
  adminMessages = adminMessages.filter(m => !isOlderThan24Hours(m.date));
  
  await writeData(messagesPath, messages);
  await writeData(adminMessagesPath, adminMessages);

  const sellerProducts = products.filter(p => p.sellerId === req.seller.id);

  // Only show UNREPLIED customer messages (max 5)
  const customerMessages = messages
    .filter(m => m.sellerId === req.seller.id && !m.reply)
    .slice(0, 5)
    .map(m => {
      const product = products.find(p => p.id === m.productId) || {};
      return {
        ...m,
        productName: product.name || 'Unknown Product',
        productImage: product.images?.[0] || '/images/default.jpg'
      };
    });

  // Only show UNREPLIED admin messages (max 5)
  const filteredAdminMessages = adminMessages
    .filter(m => m.sellerId === req.seller.id && !m.reply)
    .slice(0, 5);

  res.render('seller/dashboard', {
    seller: req.seller,
    products: sellerProducts,
    customerMessages,
    adminMessages: filteredAdminMessages,
    msg: req.query.success,
    err: req.query.error
  });
});



// ✅ Mark order status: processing, shipped, delivered
router.post('/orders/:id/status', isSeller, async (req, res) => {
  const orderId = req.params.id;
  const newStatus = req.body.status;

  try {
    const orders = await readData(ordersPath);
    const index = orders.findIndex(o => o.id === orderId && o.sellerId === req.seller.id);

    if (index === -1) return res.redirect('/seller/orders?error=Order not found');

    orders[index].status = newStatus;
    await writeData(ordersPath, orders);

    // send customer email
    const customerEmail = orders[index].customerEmail;
    const emailText = `Your order (${orders[index].id}) is now marked as ${newStatus}.`;
    if (customerEmail) await sendEmail(customerEmail, `Order ${newStatus}`, emailText);

    res.redirect('/seller/orders?success=Order updated');
  } catch (err) {
    console.error('Update order error:', err);
    res.redirect('/seller/orders?error=Failed to update');
  }
});

// 🧾 Invoice view
router.get('/invoice/:id', isSeller, async (req, res) => {
  const orderId = req.params.id;
  const orders = await readData(ordersPath);
  const order = orders.find(o => o.id === orderId && o.sellerId === req.seller.id);

  if (!order) return res.status(404).send('Invoice not found');

  res.render('seller/invoice', {
    order,
    seller: req.seller
  });
});

router.get('/dashboard', isSeller, async (req, res) => {
  const products = await readData(productsPath);
  let messages = await readData(messagesPath);
  
  // Filter out messages older than 24 hours
  messages = messages.filter(m => !isOlderThan24Hours(m.createdAt));
  await writeData(messagesPath, messages);

  const sellerProducts = products.filter(p => p.sellerId === req.seller.id);

  // Only show UNREPLIED messages in dashboard (max 5)
  const sellerMessages = messages
    .filter(m => m.sellerId === req.seller.id && !m.reply)
    .slice(0, 5)
    .map(m => {
      const product = products.find(p => p.id === m.productId) || {};
      return {
        ...m,
        productName: product.name || 'Unknown Product',
        productImage: product.images?.[0] || '/images/default.jpg'
      };
    });

  res.render('seller/dashboard', {
    seller: req.seller,
    products: sellerProducts,
    messages: sellerMessages,
    msg: req.query.success,
    err: req.query.error
  });
});

router.get('/add-product', isSeller, (req, res) => {
  res.render('seller/add-product', { error: null, formData: {}, seller: req.seller });
});

router.post('/add-product',
  isSeller,
  upload.array('images', 5),
  [
    body('name').notEmpty().withMessage('Product name is required'),
    body('price').isFloat({ gt: 0 }).withMessage('Price must be > 0'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('description').isLength({ max: 1000 }).withMessage('Description too long')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('seller/add-product', {
        error: errors.array()[0].msg,
        formData: req.body,
        seller: req.seller
      });
    }

    const { name, price, description, quantity } = req.body;
    const images = req.files.map(f => '/images/' + f.filename);
    const products = await readData(productsPath);

    const newProduct = {
      id: Date.now().toString(),
      name: name.trim(),
      price: parseFloat(price),
      quantity: parseInt(quantity),
      description: description.trim(),
      images,
      sellerId: req.seller.id,
      sellerName: req.seller.name,
      approved: false,
      blocked: false,
      createdAt: new Date().toISOString()
    };

    products.push(newProduct);
    await writeData(productsPath, products);
    res.redirect('/seller/dashboard?success=Product submitted for approval');
  }
);

// ✅ Edit Product with quantity
router.get('/edit-product/:id', isSeller, async (req, res) => {
  const productId = req.params.id;
  const products = await readData(productsPath);
  const product = products.find(p => p.id === productId && p.sellerId === req.seller.id);

  if (!product) {
    return res.render('seller/edit-product', {
      product: {},
      error: 'Product not found or not yours.',
      success: null,
      seller: req.seller
    });
  }

  res.render('seller/edit-product', {
    product,
    error: null,
    success: null,
    seller: req.seller
  });
});

router.post('/edit-product/:id', isSeller, upload.array('images', 5), async (req, res) => {
  const productId = req.params.id;
  const products = await readData(productsPath);
  const index = products.findIndex(p => p.id === productId && p.sellerId === req.seller.id);

  if (index === -1) {
    return res.render('seller/edit-product', {
      product: {},
      error: 'Product not found or not yours.',
      success: null,
      seller: req.seller
    });
  }

  const { name, price, description, quantity } = req.body;

  if (!name || !price || !description || !quantity) {
    return res.render('seller/edit-product', {
      product: products[index],
      error: 'All fields are required.',
      success: null,
      seller: req.seller
    });
  }

  products[index].name = name.trim();
  products[index].price = parseFloat(price);
  products[index].description = description.trim();
  products[index].quantity = parseInt(quantity);

  if (req.files && req.files.length > 0) {
    products[index].images = req.files.map(f => '/images/' + f.filename);
  }

  await writeData(productsPath, products);
  res.redirect('/seller/dashboard?success=Product updated successfully');
});

router.get('/messages', isSeller, async (req, res) => {
  let messages = await readData(messagesPath);
  let adminMessages = await readData(adminMessagesPath);
  const products = await readData(productsPath);

  // Filter out old messages
  messages = messages.filter(m => !isOlderThan24Hours(m.createdAt));
  adminMessages = adminMessages.filter(m => !isOlderThan24Hours(m.createdAt));
  
  // Save the filtered messages back
  await writeData(messagesPath, messages);
  await writeData(adminMessagesPath, adminMessages);

  const sellerMessages = messages
    .filter(m => m.sellerId === req.seller.id)
    .map(m => {
      const product = products.find(p => p.id === m.productId) || {};
      return {
        ...m,
        productName: product.name || 'Unknown Product',
        productImage: product.images?.[0] || '/images/default.jpg'
      };
    });

  const sellerAdminMessages = adminMessages.filter(m => m.sellerId === req.seller.id);

  res.render('seller/messages', {
    seller: req.seller,
    messages: sellerMessages,
    adminMessages: sellerAdminMessages,
    msg: req.query.success,
    err: req.query.error
  });
});

router.get('/register', (req, res) => {
  res.render('seller/register', {
    error: null,
    success: null,
    formData: {}
  });
});

router.post('/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Email is invalid'),
    body('phone').notEmpty().withMessage('Phone is required'),
    body('password').isLength({ min: 6 }).withMessage('Min 6 char password')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('seller/register', {
        error: errors.array()[0].msg,
        success: null,
        formData: req.body
      });
    }

    const sellers = await readData(sellersPath);
    const { name, email, phone, password } = req.body;
    const exists = sellers.find(s => s.email === email.trim().toLowerCase());
    if (exists) {
      return res.render('seller/register', {
        error: 'Email already exists',
        success: null,
        formData: req.body
      });
    }

    const newSeller = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone,
      password,
      approved: false,
      blocked: false,
      createdAt: new Date().toISOString()
    };

    sellers.push(newSeller);
    await writeData(sellersPath, sellers);
    res.redirect('/seller/login?success=Account created. Wait for approval.');
  }
);

router.post('/delete-product/:id', isSeller, async (req, res) => {
  const productId = req.params.id;
  const products = await readData(productsPath);
  const filteredProducts = products.filter(p => !(p.id === productId && p.sellerId === req.seller.id));
  await writeData(productsPath, filteredProducts);
  res.redirect('/seller/dashboard?success=Product deleted successfully');
});

// 🧾 Seller Orders
router.get('/orders', isSeller, async (req, res) => {
  try {
    const allOrders = await readData(ordersPath);
    const sellerOrders = allOrders.filter(o => o.sellerId === req.seller.id);

    res.render('seller/orders', {
      seller: req.seller,
      orders: sellerOrders
    });
  } catch (err) {
    console.error('Load seller orders failed:', err);
    res.render('seller/orders', {
      seller: req.seller,
      orders: [],
      error: 'Could not load orders.'
    });
  }
});

// 🟡 Update Order Status
router.post('/orders/:id/status', isSeller, async (req, res) => {
  const orderId = req.params.id;
  const newStatus = req.body.status;

  try {
    const orders = await readData(ordersPath);
    const index = orders.findIndex(o => o.id === orderId && o.sellerId === req.seller.id);

    if (index === -1) {
      return res.redirect('/seller/orders?error=Order not found');
    }

    orders[index].status = newStatus;
    await writeData(ordersPath, orders);
    res.redirect('/seller/orders?success=Status updated');
  } catch (err) {
    console.error('Update status failed:', err);
    res.redirect('/seller/orders?error=Status update failed');
  }
});

router.post('/reply/:id', isSeller, async (req, res) => {
  const messages = await readData(messagesPath);
  const msgIndex = messages.findIndex(m => m.id === req.params.id && m.sellerId === req.seller.id);

  if (msgIndex === -1) {
    return res.redirect('/seller/messages?error=Message not found.');
  }

  messages[msgIndex].reply = req.body.reply.trim();
  await writeData(messagesPath, messages);

  res.redirect('/seller/messages?success=Reply sent.');
});

// Seller reply to admin message
router.post('/admin-reply/:id', isSeller, async (req, res) => {
  const messageId = req.params.id;
  const replyText = req.body.reply?.trim();

  if (!replyText) {
    return res.redirect('/seller/messages?error=Reply cannot be empty');
  }

  try {
    const adminMessages = await readData(adminMessagesPath);
    const index = adminMessages.findIndex(
      msg => msg.id === messageId && msg.sellerId === req.seller.id
    );

    if (index === -1) {
      return res.redirect('/seller/messages?error=Message not found.');
    }

    adminMessages[index].reply = replyText;
    adminMessages[index].repliedAt = new Date().toISOString();

    await writeData(adminMessagesPath, adminMessages);

    res.redirect('/seller/messages?success=Reply sent successfully');
  } catch (err) {
    console.error('Admin reply failed:', err);
    res.redirect('/seller/messages?error=Failed to send reply');
  }
});
router.get('/dashboard', isSeller, async (req, res) => {
  const products = await readData(productsPath);
  let messages = await readData(messagesPath);
  let adminMessages = await readData(adminMessagesPath);
  
  // Filter out messages older than 24 hours
  const now = new Date();
  messages = messages.filter(m => !isOlderThan24Hours(m.createdAt));
  adminMessages = adminMessages.filter(m => !isOlderThan24Hours(m.date));
  
  await writeData(messagesPath, messages);
  await writeData(adminMessagesPath, adminMessages);

  const sellerProducts = products.filter(p => p.sellerId === req.seller.id);

  // Only show UNREPLIED customer messages (max 5)
  const customerMessages = messages
    .filter(m => m.sellerId === req.seller.id && !m.reply)
    .slice(0, 5)
    .map(m => {
      const product = products.find(p => p.id === m.productId) || {};
      return {
        ...m,
        productName: product.name || 'Unknown Product',
        productImage: product.images?.[0] || '/images/default.jpg'
      };
    });

  // Only show UNREPLIED admin messages (max 5)
  const filteredAdminMessages = adminMessages
    .filter(m => m.sellerId === req.seller.id && !m.reply)
    .slice(0, 5);

  res.render('seller/dashboard', {
    seller: req.seller,
    products: sellerProducts,
    customerMessages,
    adminMessages: filteredAdminMessages,
    msg: req.query.success,
    err: req.query.error
  });
});

router.post('/orders/:id/delete', isSeller, async (req, res) => {
  try {
    const orders = await readData(ordersPath);
    
    // Filter to keep only orders that DON'T match this ID AND are from this seller
    const filteredOrders = orders.filter(o => !(o.id === req.params.id && o.sellerId === req.seller.id));
    
    await writeData(ordersPath, filteredOrders);
    res.redirect('/seller/orders?success=Order deleted successfully');
  } catch (err) {
    console.error('Delete order error:', err);
    res.redirect('/seller/orders?error=Failed to delete order');
  }
});

router.post('/orders/:id/delete', isSeller, async (req, res) => {
  console.log('Attempting to delete order:', req.params.id, 'for seller:', req.seller.id);
  try {
    const orders = await readData(ordersPath);
    console.log('Current orders:', orders.length);
    
    const filteredOrders = orders.filter(o => !(o.id === req.params.id && o.sellerId === req.seller.id));
    console.log('Orders after filter:', filteredOrders.length);
    
    await writeData(ordersPath, filteredOrders);
    res.redirect('/seller/orders?success=Order deleted successfully');
  } catch (err) {
    console.error('Delete order error:', err);
    res.redirect('/seller/orders?error=Failed to delete order');
  }
});
module.exports = router;