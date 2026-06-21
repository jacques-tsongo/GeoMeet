const form = document.getElementById('registerForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Inscription impossible.');
    }

    localStorage.setItem('geomeet_token', data.token);
    localStorage.setItem('geomeet_user', JSON.stringify(data.user));
    window.location.href = 'dashboard.html';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
  }
});
