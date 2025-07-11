const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");

function updateFavoriteCount() {
  const count = document.getElementById("favorite-count");
  if (count) count.innerText = favorites.length;
}

function toggleFavorites() {
  const sidebar = document.getElementById("favorites-sidebar");
  if (sidebar) {
    sidebar.classList.toggle("open");
    renderFavorites();
  }
}

function addToFavorites(product) {
  if (!favorites.find(p => p.id === product.id)) {
    product.quantity = 1;
    favorites.push(product);
    localStorage.setItem("favorites", JSON.stringify(favorites));
    updateFavoriteCount();
    alert("Added to favorites!");
  } else {
    alert("Already in favorites.");
  }
}

function renderFavorites() {
  const list = document.getElementById("favorites-list");
  if (!list) return;

  list.innerHTML = "";
  favorites.forEach(product => {
    const item = document.createElement("div");
    item.className = "favorite-item";
    item.innerHTML = `
      <img src="${product.images?.[0] || '/images/default.jpg'}">
      <div class="favorite-info">
        <h4>${product.name}</h4>
        <p>$${product.price.toFixed(2)}</p>
        <label>Qty: 
          <input type="number" value="${product.quantity}" min="1" onchange="updateQuantity(${product.id}, this.value)">
        </label>
        <br>
        <button class="btn-small" onclick="moveToCart(${product.id})">Add to Cart</button>
      </div>
    `;
    list.appendChild(item);
  });
}

function updateQuantity(id, qty) {
  const p = favorites.find(f => f.id === id);
  if (p) {
    p.quantity = parseInt(qty);
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }
}

function moveToCart(productId) {
  const product = favorites.find(p => p.id === productId);
  if (product) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/add-to-cart/" + productId;

    const qty = document.createElement("input");
    qty.type = "hidden";
    qty.name = "qty";
    qty.value = product.quantity || 1;

    form.appendChild(qty);
    document.body.appendChild(form);
    form.submit();
  }
}

// ✅ On page load
updateFavoriteCount?.();
