const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();

const SELLERS_PATH = path.resolve(__dirname, '../models/sellers.json');
const PRODUCTS_PATH = path.resolve(__dirname, '../models/products.json');
const ADMIN_MESSAGES_PATH = path.resolve(__dirname, '../models/adminMessages.json');
const SELLER_MESSAGES_PATH = path.resolve(__dirname, '../models/messages.json');

// Helper functions
const readData = async (filePath, defaultData = []) => {
  try {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return content.trim() ? JSON.parse(content) : defaultData;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return defaultData;
  }
};

const writeData = async (filePath, data) => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error);
    throw error;
  }
};

// Admin Dashboard Route
router.get('/dashboard', async (req, res, next) => {
  try {
    const { search = '', filter = 'all', view = 'sellers' } = req.query;
    const searchTerm = search.toLowerCase();

    const [sellers, products, adminMessages, sellerMessages] = await Promise.all([
      readData(SELLERS_PATH),
      readData(PRODUCTS_PATH),
      readData(ADMIN_MESSAGES_PATH),
      readData(SELLER_MESSAGES_PATH)
    ]);

    // Filter sellers
    let filteredSellers = sellers.filter(seller => {
      const matchesSearch = searchTerm 
        ? ((seller.name && seller.name.toLowerCase().includes(searchTerm)) ||
           (seller.email && seller.email.toLowerCase().includes(searchTerm)))
        : true;
      
      const matchesStatus = filter === 'all' ? true :
        filter === 'approved' ? seller.approved && !seller.blocked :
        filter === 'pending' ? !seller.approved && !seller.blocked :
        filter === 'blocked' ? seller.blocked : true;
      
      return matchesSearch && matchesStatus;
    });

    // Enhance sellers with messages and products
    const sellersWithData = filteredSellers.map(seller => {
      const sellerProducts = products.filter(p => p.sellerId === seller.id);
      const adminMsgs = adminMessages.filter(m => m.sellerId === seller.id);
      const sellerMsgs = sellerMessages
        .filter(m => m.sellerId === seller.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      const unreadCount = sellerMsgs.filter(m => !m.seen).length;

      return {
        ...seller,
        products: sellerProducts,
        adminMessages: adminMsgs,
        sellerMessages: sellerMsgs,
        unreadMessages: unreadCount,
        lastMessage: [...adminMsgs, ...sellerMsgs].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
      };
    });

    // Prepare view-specific data
    let viewData = {};
    if (view === 'products') {
      viewData.allProducts = products.map(p => {
        const seller = sellers.find(s => s.id === p.sellerId);
        return {
          ...p,
          sellerName: seller ? seller.name : 'Unknown',
          status: p.approved ? 'approved' : 'pending'
        };
      });
    } else if (view === 'messages') {
      viewData.sellersWithMessages = sellersWithData.filter(s => 
        s.adminMessages.length > 0 || s.sellerMessages.length > 0
      );
    }

    res.render('admin/dashboard', {
      sellers: sellersWithData,
      search,
      filter,
      view,
      ...viewData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    next(error);
  }
});

// Get messages for a specific seller
router.get('/seller-messages/:sellerId', async (req, res) => {
  try {
    const sellerId = req.params.sellerId;
    const [adminMessages, sellerMessages] = await Promise.all([
      readData(ADMIN_MESSAGES_PATH),
      readData(SELLER_MESSAGES_PATH)
    ]);

    const messages = [
      ...adminMessages.filter(m => m.sellerId === sellerId).map(m => ({ ...m, fromAdmin: true })),
      ...sellerMessages.filter(m => m.sellerId === sellerId).map(m => ({ ...m, fromAdmin: false }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('Error getting seller messages:', error);
    res.status(500).json({ success: false });
  }
});

// Toggle Seller Status
router.post('/toggle-seller/:id', async (req, res, next) => {
  try {
    const { action, reason } = req.body;
    const sellers = await readData(SELLERS_PATH);
    const sellerIndex = sellers.findIndex(s => s.id === req.params.id);

    if (sellerIndex === -1) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const seller = sellers[sellerIndex];

    switch (action) {
      case 'approve':
        seller.approved = true;
        seller.blocked = false;
        seller.rejectionReason = '';
        break;
      case 'reject':
        if (!reason) {
          return res.status(400).json({ error: 'Reason is required for rejection' });
        }
        seller.approved = false;
        seller.rejectionReason = reason;
        break;
      case 'block':
        seller.blocked = true;
        break;
      case 'unblock':
        seller.blocked = false;
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    seller.updatedAt = new Date().toISOString();

    await writeData(SELLERS_PATH, sellers);

    res.json({
      success: true,
      seller: {
        id: seller.id,
        status: seller.blocked ? 'blocked' : seller.approved ? 'approved' : 'pending',
        rejectionReason: seller.rejectionReason || ''
      }
    });
  } catch (error) {
    console.error('Toggle seller error:', error);
    next(error);
  }
});

// Toggle Product Approval
router.post('/toggle-product/:id', async (req, res, next) => {
  try {
    const { action } = req.body;
    const products = await readData(PRODUCTS_PATH);
    const productIndex = products.findIndex(p => p.id === req.params.id);

    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[productIndex];

    if (action === 'approve') {
      product.approved = true;
    } else if (action === 'reject') {
      product.approved = false;
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    product.updatedAt = new Date().toISOString();

    await writeData(PRODUCTS_PATH, products);

    res.json({ success: true });
  } catch (error) {
    console.error('Toggle product error:', error);
    next(error);
  }
});

// Send Admin Message to Seller
router.post('/message-seller/:id', async (req, res) => {
  try {
    const sellerId = req.params.id;
    const { text } = req.body;

    if (!text || !sellerId) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const adminMessages = await readData(ADMIN_MESSAGES_PATH);
    const newMessage = {
      id: Date.now().toString(),
      sellerId,
      text,
      date: new Date().toISOString(),
      seen: true
    };

    adminMessages.push(newMessage);
    await writeData(ADMIN_MESSAGES_PATH, adminMessages);

    res.json({
      success: true,
      message: newMessage
    });
  } catch (err) {
    console.error('Error sending message to seller:', err);
    res.status(500).json({ success: false });
  }
});

// Mark seller messages as seen
router.post('/mark-messages-seen/:sellerId', async (req, res) => {
  try {
    const sellerId = req.params.sellerId;
    const sellerMessages = await readData(SELLER_MESSAGES_PATH);
    let changed = false;

    const updatedMessages = sellerMessages.map(msg => {
      if (msg.sellerId === sellerId && !msg.seen) {
        changed = true;
        return { ...msg, seen: true };
      }
      return msg;
    });

    if (changed) {
      await writeData(SELLER_MESSAGES_PATH, updatedMessages);
    }

    res.json({ 
      success: true,
      updatedCount: changed ? updatedMessages.filter(m => m.sellerId === sellerId && m.seen).length : 0
    });
  } catch (err) {
    console.error('Error marking messages as seen:', err);
    res.status(500).json({ success: false });
  }
});

// Error handler
router.use((err, req, res, next) => {
  console.error('Admin route error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;