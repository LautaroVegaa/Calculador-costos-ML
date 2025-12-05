// assets/js/admin.js

// Variables Globales
let ID_EN_EDICION = null;
let ID_A_BORRAR = null; // <-- NUEVA VARIABLE PARA EL MODAL
let timeoutBusqueda = null;

// Inicialización
window.addEventListener('load', () => {
    // 1. Fecha hoy
    const fechaInput = document.getElementById('fecha');
    if(fechaInput) fechaInput.valueAsDate = new Date();

    // 2. Parámetros URL (Redirección desde faltantes)
    const params = new URLSearchParams(window.location.search);
    const productoFaltante = params.get('producto');
    
    if (productoFaltante) {
        document.getElementById('nombreProducto').value = decodeURIComponent(productoFaltante);
        document.getElementById('costo').focus();
    }

    // 3. Cargar tabla
    cargarHistorialReciente();
});

// --- LÓGICA DE GUARDADO ---
async function guardarCosto() {
    const btn = document.getElementById('btnGuardar');
    const nombre = document.getElementById('nombreProducto').value.trim();
    const costo = document.getElementById('costo').value;
    const fecha = document.getElementById('fecha').value;

    if (!nombre || !costo || !fecha) {
        mostrarMensaje("Por favor completa todos los campos", false);
        return;
    }

    btn.disabled = true;
    btn.innerText = ID_EN_EDICION ? "Actualizando..." : "Guardando...";

    try {
        // Buscar o crear producto
        let { data: prod, error: errBusqueda } = await db
            .from('productos')
            .select('id')
            .eq('nombre_ml', nombre)
            .maybeSingle();

        if (errBusqueda) throw errBusqueda;

        let productoId;
        if (prod) {
            productoId = prod.id;
        } else {
            const { data: nuevo, error: errCreacion } = await db
                .from('productos')
                .insert([{ nombre_ml: nombre }])
                .select()
                .single();
            if (errCreacion) throw errCreacion;
            productoId = nuevo.id;
        }

        const datosCosto = { 
            producto_id: productoId, 
            costo_compra: costo, 
            fecha_vigencia: fecha 
        };

        if (ID_EN_EDICION) {
            const { error } = await db.from('historial_costos').update(datosCosto).eq('id', ID_EN_EDICION);
            if (error) throw error;
            mostrarMensaje("¡Precio actualizado! ✏️", true);
        } else {
            const { error } = await db.from('historial_costos').insert([datosCosto]);
            if (error) throw error;
            mostrarMensaje("¡Guardado correctamente! ✅", true);
        }
        
        limpiarFormulario();
        cargarHistorialReciente();

    } catch (err) {
        console.error(err);
        mostrarMensaje("Error: " + err.message, false);
    } finally {
        btn.disabled = false;
        cancelarEdicion(); // Resetea el formulario al estado original
    }
}

// --- LÓGICA DE TABLA Y BÚSQUEDA ---
function buscarCostos() {
    const termino = document.getElementById('buscador').value.trim();
    if (timeoutBusqueda) clearTimeout(timeoutBusqueda);
    timeoutBusqueda = setTimeout(() => {
        cargarHistorialReciente(termino);
    }, 300);
}

async function cargarHistorialReciente(terminoBusqueda = "") {
    const tbody = document.querySelector('#tablaHistorial tbody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Cargando...</td></tr>';

    try {
        let query = db
            .from('historial_costos')
            .select(`id, costo_compra, fecha_vigencia, productos!inner ( nombre_ml )`)
            .order('created_at', { ascending: false })
            .limit(20);

        if (terminoBusqueda) {
            query = query.ilike('productos.nombre_ml', `%${terminoBusqueda}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #888;">No se encontraron resultados</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        data.forEach(item => {
            const nombre = item.productos?.nombre_ml || 'Desconocido';
            const fechaFmt = new Date(item.fecha_vigencia).toLocaleDateString();
            const nombreSafe = nombre.replace(/'/g, "\\'").replace(/"/g, '&quot;');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-size:0.85em">${fechaFmt}</td>
                <td style="font-size:0.85em;" title="${nombreSafe}">${nombre}</td>
                <td>$${item.costo_compra}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="prepararEdicion('${item.id}', '${nombreSafe}', '${item.costo_compra}', '${item.fecha_vigencia}')"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn-delete" onclick="borrarCosto('${item.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="4" style="color:red; text-align:center">Error de conexión</td></tr>';
    }
}

// --- EDICIÓN ---
function prepararEdicion(id, nombre, costo, fecha) {
    document.getElementById('nombreProducto').value = nombre;
    document.getElementById('costo').value = costo;
    document.getElementById('fecha').value = fecha;
    ID_EN_EDICION = id;
    
    document.getElementById('tituloForm').innerText = "Editando Precio";
    const btn = document.getElementById('btnGuardar');
    btn.innerText = "Actualizar Precio";
    btn.style.background = "#0284c7";
    document.getElementById('btnCancelar').style.display = "block";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelarEdicion() {
    ID_EN_EDICION = null;
    document.getElementById('tituloForm').innerText = "Nuevo Precio de Costo";
    const btn = document.getElementById('btnGuardar');
    btn.innerText = "Guardar Precio";
    btn.style.background = "";
    document.getElementById('btnCancelar').style.display = "none";
    limpiarFormulario();
}

function limpiarFormulario() {
    document.getElementById('costo').value = '';
    document.getElementById('nombreProducto').value = '';
    document.getElementById('fecha').valueAsDate = new Date();
}

// --- ELIMINACIÓN (NUEVA LÓGICA CON MODAL) ---

// 1. Se llama al hacer click en el tacho de basura
function borrarCosto(id) {
    ID_A_BORRAR = id; // Guardamos el ID temporalmente
    document.getElementById('modalConfirmarBorrar').classList.add('open');
}

// 2. Se llama al hacer click en "Cancelar" o fuera del modal
function cancelarBorrado() {
    ID_A_BORRAR = null;
    document.getElementById('modalConfirmarBorrar').classList.remove('open');
}

// 3. Se llama al hacer click en "Sí, eliminar"
async function confirmarBorrado() {
    if (!ID_A_BORRAR) return;

    try {
        const { error } = await db.from('historial_costos').delete().eq('id', ID_A_BORRAR);
        if (error) throw error;

        mostrarMensaje("Precio eliminado correctamente", true);
        // Recargar la tabla manteniendo la búsqueda actual
        cargarHistorialReciente(document.getElementById('buscador').value);

    } catch (error) {
        mostrarMensaje("Error: " + error.message, false);
    } finally {
        cancelarBorrado(); // Cerrar modal y limpiar variable
    }
}

// Cierra el modal si se hace click en el fondo oscuro
document.getElementById('modalConfirmarBorrar')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalConfirmarBorrar') cancelarBorrado();
});

// --- UTILIDADES ---
function mostrarMensaje(texto, esExito) {
    const div = document.getElementById('mensaje');
    div.innerText = texto;
    div.style.display = 'block';
    div.className = esExito ? 'exito' : 'error';
    setTimeout(() => div.style.display = 'none', 3000);
}