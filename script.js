// Shared client-side data for the signed-in user and portal views.
const STATE = {
  currentUser: null,
  token: null,
  activeRole: 'customer',
  customerAuthMode: 'ms365',
  selectedCategory: 'All',
  cart: [],
  selectedPayment: 'Cash',
  orders: [],
  menu: [],
  toastTimeout: null
};

// Prepare the initial cart and order views after the page is ready.
document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  renderHistoryTable();
  loadMenu();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('support-modal').classList.contains('hidden')) {
      closeSupport();
    }
  });
});

// Send JSON requests to the portal API and surface server errors.
async function apiRequest(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (STATE.token) headers.Authorization = `Bearer ${STATE.token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function showError(error) {
  alert(error.message || 'Something went wrong. Please try again.');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// Switch between customer and staff authentication panels.
function switchMainRole(role) {
  STATE.activeRole = role;
  document.getElementById('btn-tab-customer').classList.toggle('active', role === 'customer');
  document.getElementById('btn-tab-staff').classList.toggle('active', role === 'staff');
  document.getElementById('customer-auth-container').classList.toggle('hidden', role !== 'customer');
  document.getElementById('staff-auth-container').classList.toggle('hidden', role !== 'staff');
}

function switchCustomerAuthMode(mode) {
  STATE.customerAuthMode = mode;
  document.getElementById('btn-sub-ms365').classList.toggle('active', mode === 'ms365');
  document.getElementById('btn-sub-idpass').classList.toggle('active', mode === 'idpass');
  document.getElementById('cust-ms365-view').classList.toggle('hidden', mode !== 'ms365');
  document.getElementById('cust-idpass-view').classList.toggle('hidden', mode !== 'idpass');
  document.getElementById('cust-register-view').classList.add('hidden');
  document.getElementById('show-register-btn').classList.remove('hidden');
  document.getElementById('cust-sub-desc').textContent = mode === 'ms365'
    ? 'Use your official STI Microsoft 365 account to securely access the menu and your orders.'
    : 'Sign in with your customer ID and password.';
}

function loginWithMicrosoft() {
  alert('Microsoft sign-in is not connected yet. Please use ID & Password.');
  switchCustomerAuthMode('idpass');
}

function showRegistration() {
  switchCustomerAuthMode('idpass');
  document.getElementById('cust-idpass-view').classList.add('hidden');
  document.getElementById('cust-register-view').classList.remove('hidden');
  document.getElementById('show-register-btn').classList.add('hidden');
  const feedback = document.getElementById('register-feedback');
  feedback.textContent = '';
  feedback.className = 'login-feedback hidden';
}

function hideRegistration() {
  document.getElementById('cust-register-view').classList.add('hidden');
  document.getElementById('cust-idpass-view').classList.remove('hidden');
  document.getElementById('show-register-btn').classList.remove('hidden');
  const feedback = document.getElementById('register-feedback');
  feedback.textContent = '';
  feedback.className = 'login-feedback hidden';
}

// Submit customer registration and prepare the sign-in form.
async function handleCustomerRegistration(event) {
  event.preventDefault();
  try {
    const result = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        userId: document.getElementById('register-id').value,
        fullName: document.getElementById('register-name').value,
        email: document.getElementById('register-email').value,
        password: document.getElementById('register-pass').value
      })
    });
    alert(result.message);
    document.getElementById('cust-id').value = document.getElementById('register-id').value;
    document.getElementById('cust-pass').value = '';
    document.getElementById('cust-register-view').reset();
    hideRegistration();
  } catch (error) {
    const feedback = document.getElementById('register-feedback');
    feedback.textContent = error.message || 'Could not create account. Please try again.';
    feedback.className = 'login-feedback error';
  }
}

async function handleCustomerLogin(event) {
  event.preventDefault();
  await signIn(
    document.getElementById('cust-id').value,
    document.getElementById('cust-pass').value,
    'customer'
  );
}

async function handleStaffLogin(event) {
  event.preventDefault();
  await signIn(
    document.getElementById('staff-id').value,
    document.getElementById('staff-pass').value,
    'staff'
  );
}

// Authenticate an account and open the matching dashboard.
async function signIn(userId, password, expectedRole) {
  const formId = expectedRole === 'customer' ? 'cust-idpass-view' : 'staff-idpass-view';
  const feedbackId = expectedRole === 'customer' ? 'customer-login-feedback' : 'staff-login-feedback';
  const form = document.getElementById(formId);
  const submitButton = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById(feedbackId);
  feedback.className = 'login-feedback hidden';
  feedback.textContent = '';
  submitButton.disabled = true;

  try {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ userId, password })
    });
    if (expectedRole === 'staff' && !['staff', 'admin'].includes(result.user.role)) {
      throw new Error('This account does not have staff access.');
    }
    if (expectedRole === 'customer' && result.user.role !== 'customer') {
      throw new Error('Please use the staff sign-in tab for this account.');
    }
    STATE.token = result.token;
    STATE.currentUser = result.user;
    feedback.textContent = 'Successfully logged in!';
    feedback.className = 'login-feedback success';
    await new Promise(resolve => setTimeout(resolve, 1200));
    showDashboard(result.user);
    await loadOrders();
  } catch (error) {
    feedback.textContent = error.message || 'Could not log in. Please try again.';
    feedback.className = 'login-feedback error';
    submitButton.disabled = false;
  }
}

// Fill account details and switch from sign-in to the portal.
function showDashboard(user) {
  const displayRole = user.role === 'customer' ? 'Customer' : 'Café Staff';
  document.getElementById('header-user-name').textContent = user.name;
  document.getElementById('header-user-role').textContent = displayRole;
  document.getElementById('sidebar-name').textContent = user.name;
  document.getElementById('sidebar-role').textContent = displayRole;

  const initials = user.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('header-avatar').textContent = initials;
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('settings-avatar').textContent = initials;
  document.getElementById('settings-name').value = user.name;
  document.getElementById('settings-email').value = user.email;
  document.getElementById('delete-account-section').classList.toggle('hidden', user.role !== 'customer');
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
}

function handleLogout() {
  STATE.currentUser = null;
  STATE.token = null;
  STATE.orders = [];
  STATE.cart = [];
  updateCartUI();
  renderHistoryTable();
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

// Show the selected dashboard page and mark its navigation item.
function navigateTo(pageId) {
  const pages = ['home', 'history', 'tracking', 'discounts', 'settings'];
  pages.forEach(page => {
    document.getElementById(`page-${page}`).classList.toggle('hidden', page !== pageId);
    document.getElementById(`nav-${page}`).classList.toggle('active', page === pageId);
  });
}

// Load available items, then render the menu cards.
async function loadMenu() {
  try {
    STATE.menu = await apiRequest('/api/menu');
    renderMenu();
  } catch (error) {
    document.getElementById('menu-items-grid').textContent = 'Could not load the menu. Please refresh the page.';
    showError(error);
  }
}

function renderMenu(items = STATE.menu) {
  const grid = document.getElementById('menu-items-grid');
  if (!items.length) {
    grid.textContent = 'No menu items found.';
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="food-card">
      <div class="food-img" style="background-image: url('${escapeHtml(item.img)}')">
        ${item.badge ? `<span class="tag-badge">🔥 ${escapeHtml(item.badge)}</span>` : ''}
        <span class="price-badge">₱${Number(item.price).toFixed(2)}</span>
      </div>
      <div class="food-details">
        <div>
          <h4>${escapeHtml(item.name)}</h4>
          <p>${escapeHtml(item.desc)}</p>
        </div>
        <div class="card-bottom">
          <button class="btn-view" type="button">View item details</button>
          <button class="btn-add" type="button" onclick="addToCart(${Number(item.id)})">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Apply category and search filters to the menu.
function filterCategory(category, button) {
  STATE.selectedCategory = category;
  document.querySelectorAll('.pill-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  filterMenu();
}

function filterMenu() {
  const query = document.getElementById('menu-search-input').value.toLowerCase();
  const filtered = STATE.menu.filter(item => {
    const matchesCategory = STATE.selectedCategory === 'All' || item.category === STATE.selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(query) || item.desc.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  renderMenu(filtered);
}

// Keep cart quantities and totals in sync with the selected menu items.
function addToCart(itemId) {
  const item = STATE.menu.find(menuItem => menuItem.id === itemId);
  if (!item) return;
  const existing = STATE.cart.find(cartItem => cartItem.id === itemId);
  if (existing) existing.qty += 1;
  else STATE.cart.push({ ...item, qty: 1 });
  updateCartUI();
}

function updateQty(itemId, delta) {
  const item = STATE.cart.find(cartItem => cartItem.id === itemId);
  if (item) {
    item.qty += delta;
    if (item.qty <= 0) STATE.cart = STATE.cart.filter(cartItem => cartItem.id !== itemId);
  }
  updateCartUI();
}

function updateCartUI() {
  const totalCount = STATE.cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = STATE.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  document.getElementById('cart-badge-count').textContent = totalCount;
  document.getElementById('cart-total-price').textContent = `₱${totalPrice.toFixed(2)}`;
  document.getElementById('place-order-btn').disabled = STATE.cart.length === 0;

  const list = document.getElementById('cart-items-list');
  if (STATE.cart.length === 0) {
    list.innerHTML = '<div class="empty-cart-view"><span class="cart-icon">🛒</span><p>Your cart is empty</p></div>';
    return;
  }
  list.innerHTML = STATE.cart.map(item => `
    <div class="cart-item-row">
      <div>
        <div class="cart-item-title">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">₱${Number(item.price).toFixed(2)} x ${item.qty}</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">-</button>
        <span>${item.qty}</span>
        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
    </div>
  `).join('');
}

function toggleCartDrawer() {
  document.getElementById('cart-drawer-overlay').classList.toggle('hidden');
  document.getElementById('cart-drawer').classList.toggle('hidden');
}

function selectPayment(method, button) {
  STATE.selectedPayment = method;
  document.querySelectorAll('.pay-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
}

// Submit the cart, then refresh order status and show confirmation.
async function placeOrder() {
  if (!STATE.cart.length) return;
  try {
    const result = await apiRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        paymentMethod: STATE.selectedPayment,
        items: STATE.cart.map(item => ({ id: item.id, quantity: item.qty }))
      })
    });
    STATE.cart = [];
    updateCartUI();
    toggleCartDrawer();
    await loadOrders();
    document.getElementById('active-orders-container').innerHTML = `
      <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <h4>Order #${escapeHtml(result.orderNumber)}</h4>
        <p>Status: <strong>Preparing in Kitchen</strong></p>
        <p>Total: ₱${Number(result.totalAmount).toFixed(2)}</p>
      </div>
    `;
    alert(`Order ${result.orderNumber} placed successfully!`);
    navigateTo('tracking');
  } catch (error) {
    showError(error);
  }
}

// Refresh the history and current preparing-order views.
async function loadOrders() {
  try {
    STATE.orders = await apiRequest('/api/orders');
    renderHistoryTable();
    const activeOrder = STATE.orders.find(order => order.status === 'PREPARING');
    const container = document.getElementById('active-orders-container');
    if (!activeOrder) {
      container.classList.add('empty-state-card');
      container.textContent = 'You have no active orders right now.';
      return;
    }
    container.classList.remove('empty-state-card');
    container.innerHTML = `
      <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <h4>Order #${escapeHtml(activeOrder.orderNumber)}</h4>
        <p>Status: <strong>${escapeHtml(activeOrder.status)}</strong></p>
        <p>${escapeHtml(activeOrder.items)}</p>
      </div>
    `;
  } catch (error) {
    showError(error);
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = STATE.orders.map(order => {
    const createdAt = new Date(`${order.createdAt.replace(' ', 'T')}Z`);
    return `
      <tr>
        <td style="font-weight: 700; color: #d97706;">${escapeHtml(order.orderNumber)}</td>
        <td>${escapeHtml(order.items)}</td>
        <td>${createdAt.toLocaleString()}</td>
        <td><span class="status-pill ${escapeHtml(order.status.toLowerCase())}">${escapeHtml(order.status)}</span></td>
        <td>${escapeHtml(order.paymentMethod)} · ₱${Number(order.totalAmount).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

// Update the profile details shown in the current screen.
function saveSettings() {
  const newName = document.getElementById('settings-name').value;
  const newEmail = document.getElementById('settings-email').value;
  if (STATE.currentUser) {
    STATE.currentUser.name = newName;
    STATE.currentUser.email = newEmail;
    document.getElementById('header-user-name').textContent = newName;
    document.getElementById('sidebar-name').textContent = newName;
  }
  alert('Profile updated on this screen.');
}

async function deleteCustomerAccount(event) {
  event.preventDefault();
  if (!window.confirm('Permanently delete your account and all of your order history? This cannot be undone.')) return;

  const form = event.currentTarget;
  const passwordInput = document.getElementById('delete-account-password');
  const submitButton = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById('delete-account-feedback');
  submitButton.disabled = true;
  feedback.className = 'login-feedback hidden';
  feedback.textContent = '';

  try {
    const result = await apiRequest('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: passwordInput.value })
    });
    STATE.currentUser = null;
    STATE.token = null;
    STATE.orders = [];
    STATE.cart = [];
    updateCartUI();
    renderHistoryTable();
    passwordInput.value = '';
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    switchCustomerAuthMode('idpass');
    document.getElementById('cust-idpass-view').classList.remove('hidden');
    const loginFeedback = document.getElementById('customer-login-feedback');
    loginFeedback.textContent = result.message;
    loginFeedback.className = 'login-feedback success';
  } catch (error) {
    feedback.textContent = error.message || 'Could not delete the account. Please try again.';
    feedback.className = 'login-feedback error';
    submitButton.disabled = false;
  }
}

function markAllNotificationsRead() {
  document.querySelectorAll('.notif-dot').forEach(dot => dot.classList.remove('active'));
}

function showToast(message) {
  const toast = document.getElementById('app-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(STATE.toastTimeout);
  STATE.toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// Prefill and display the customer-service form.
function openSupport() {
  const modal = document.getElementById('support-modal');
  const role = document.getElementById('support-role');
  role.value = STATE.currentUser?.role === 'staff' || STATE.currentUser?.role === 'admin'
    ? 'staff'
    : 'customer';
  document.getElementById('support-name').value = STATE.currentUser?.name || '';
  document.getElementById('support-email').value = STATE.currentUser?.email || '';
  modal.classList.remove('hidden');
  document.body.classList.add('support-open');
  document.getElementById('support-category').focus();
}

function closeSupport() {
  document.getElementById('support-modal').classList.add('hidden');
  document.body.classList.remove('support-open');
}

function handleSupportBackdrop(event) {
  if (event.target === event.currentTarget) closeSupport();
}

// Send the support request and show the result to the user.
async function submitSupportTicket(event) {
  event.preventDefault();
  const submitButton = document.getElementById('support-submit');
  submitButton.disabled = true;
  try {
    const result = await apiRequest('/api/support', {
      method: 'POST',
      body: JSON.stringify({
        role: document.getElementById('support-role').value,
        category: document.getElementById('support-category').value,
        fullName: document.getElementById('support-name').value,
        email: document.getElementById('support-email').value,
        subject: document.getElementById('support-subject').value,
        message: document.getElementById('support-message').value
      })
    });
    document.getElementById('support-form').reset();
    closeSupport();
    showToast(result.message);
  } catch (error) {
    showError(error);
  } finally {
    submitButton.disabled = false;
  }
}
