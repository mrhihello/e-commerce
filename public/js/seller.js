document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('add-product-form')) {
    document.getElementById('add-product-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      
      fetch('/seller/add-product', {
        method: 'POST',
        body: formData
      }).then(res => {
        if (res.redirected) window.location.href = res.url;
      });
    });
  }
  
  if (document.getElementById('seller-products')) {
    fetchSellerProducts();
  }
});

function fetchSellerProducts() {
  fetch('/seller/products')
    .then(res => res.json())
    .then(products => {
      const container = document.getElementById('seller-products');
      container.innerHTML = products.map(product => `
        <div class="product-card">
          <img src="${product.image}" alt="${product.name}">
          <h3>${product.name}</h3>
          <p>$${product.price.toFixed(2)}</p>
          <p>Status: ${product.approved ? 'Approved' : 'Pending Approval'}</p>
        </div>
      `).join('');
    });
}