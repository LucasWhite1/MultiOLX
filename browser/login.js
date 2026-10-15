document.getElementById('loginForm').onsubmit = async (event) => {
  event.preventDefault();
  const button = document.getElementById('loginSubmit');
  button.disabled = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    location.replace('/');
  } catch (error) {
    document.getElementById('loginError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
