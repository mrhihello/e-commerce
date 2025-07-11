document.addEventListener('DOMContentLoaded', () => {
  fetchPendingSellers();
});

function fetchPendingSellers() {
  fetch('/admin/pending-sellers')
    .then(res => res.json())
    .then(sellers => {
      const container = document.getElementById('pending-sellers');
      container.innerHTML = sellers.map(seller => `
        <div class="seller-card">
          <h3>${seller.name}</h3>
          <p>${seller.email}</p>
          <button onclick="approveSeller('${seller.id}')">Approve</button>
        </div>
      `).join('');
    });
}

function approveSeller(id) {
  fetch(`/admin/approve-seller/${id}`, { method: 'POST' })
    .then(() => fetchPendingSellers());
}