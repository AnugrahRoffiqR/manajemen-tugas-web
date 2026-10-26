fetch('/api/auth/me')
  .then(res => {
    if (res.ok) {
      window.location.replace('/dashboard');
    } else {
      window.location.replace('/login');
    }
  })
  .catch(() => {
    window.location.replace('/login');
  });
