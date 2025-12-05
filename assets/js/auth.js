// assets/js/auth.js

// Verificar sesión (Redirección automática si ya está logueado en login.html)
async function checkSessionLogin() {
    const { data: { session } } = await db.auth.getSession();
    if (session) window.location.href = 'admin.html';
}

// Proteger ruta (Expulsar si no está logueado en admin.html)
async function protegerRuta() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) window.location.href = 'login.html';
}

// Iniciar Sesión
async function iniciarSesion() {
    const btn = document.getElementById('btnLogin');
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const msg = document.getElementById('errorMsg');

    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = "Verificando...";
    msg.style.display = 'none';

    try {
        const { error } = await db.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) throw error;
        window.location.href = 'admin.html';

    } catch (error) {
        console.error("Error login:", error.message);
        msg.innerText = "Credenciales incorrectas.";
        msg.style.display = 'block';
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// Cerrar Sesión
async function cerrarSesion() {
    await db.auth.signOut();
    window.location.href = 'login.html';
}