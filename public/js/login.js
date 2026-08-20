const form = document.getElementById('loginForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Connexion impossible.');
    }

    localStorage.setItem('geomeet_token', data.token);
    localStorage.setItem('geomeet_user', JSON.stringify(data.user));
    // MIGRATION HTML -> EJS : la page est desormais rendue par Express
    window.location.href = '/dashboard';
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
  }
});
