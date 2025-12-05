// assets/js/dashboard.js

let MEMORIA_PRECIOS = {}; 
let myChart = null;
let DATOS_PARA_BD = []; 
let DATOS_PARA_EXPORTAR = []; 
let PRODUCTOS_FALTANTES = new Set(); 

// 1. Carga Inicial (Base de Datos + Persistencia Local)
window.addEventListener('load', async () => {
    try {
        // A. Cargar precios de Supabase
        const { data: productos, error } = await db
            .from('productos')
            .select(`nombre_ml, historial_costos ( costo_compra, fecha_vigencia )`);

        if (error) throw error;

        productos.forEach(prod => {
            if (prod.historial_costos && prod.historial_costos.length > 0) {
                MEMORIA_PRECIOS[prod.nombre_ml] = prod.historial_costos.sort((a, b) => 
                    new Date(b.fecha_vigencia) - new Date(a.fecha_vigencia)
                );
            }
        });
        console.log("Base de datos cargada.");

        // B. (NUEVO) Verificar si hay datos persistentes en LocalStorage
        const datosGuardados = localStorage.getItem('ml_ventas_temp');
        if (datosGuardados) {
            console.log("Recuperando sesión anterior...");
            const ventas = JSON.parse(datosGuardados);
            procesarDatos(ventas, false); // false = no volver a guardar (ya está guardado)
        }

    } catch (err) {
        console.error(err);
        alert("Error de conexión: " + err.message);
    } finally {
        const loadMsg = document.getElementById('loadingMsg');
        if(loadMsg) loadMsg.style.display = 'none';
    }
});

// 2. Listener del Input Excel
const inputExcel = document.getElementById('inputExcel');
if(inputExcel) {
    inputExcel.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        const loadingMsg = document.getElementById('loadingMsg');
        
        loadingMsg.style.display = 'block';
        loadingMsg.innerText = "Analizando archivo...";
        loadingMsg.className = 'loading';

        reader.onload = (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                
                const jsonRaw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                let headerRow = 0;
                let encontrado = false;

                for(let i = 0; i < Math.min(jsonRaw.length, 20); i++) {
                    if (jsonRaw[i] && jsonRaw[i].some(c => c && c.toString().toLowerCase().includes("título"))) {
                        headerRow = i; 
                        encontrado = true;
                        break;
                    }
                }

                if (!encontrado) throw new Error("No se encontró la columna 'Título'.");
                const ventas = XLSX.utils.sheet_to_json(sheet, { range: headerRow });
                
                // Procesar y guardar en LocalStorage
                procesarDatos(ventas, true);

            } catch (error) {
                console.error(error);
                alert("Error al leer: " + error.message);
            } finally {
                loadingMsg.style.display = 'none';
                // Limpiar el input para permitir cargar el mismo archivo si es necesario
                inputExcel.value = ''; 
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// (MODIFICADO) Acepta parámetro guardarEnStorage
function procesarDatos(ventas, guardarEnStorage = false) {
    // 1. Persistencia
    if (guardarEnStorage) {
        try {
            localStorage.setItem('ml_ventas_temp', JSON.stringify(ventas));
        } catch (e) {
            console.warn("No se pudo guardar en local (archivo muy grande?)", e);
        }
    }

    // 2. Ocultar zona de carga y mostrar dashboard
    document.getElementById('cardUpload').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    let totales = { venta: 0, ml: 0, costo: 0, ganancia: 0 };
    const tbody = document.querySelector('#tablaDetalle tbody');
    tbody.innerHTML = '';
    
    DATOS_PARA_BD = []; 
    DATOS_PARA_EXPORTAR = []; 
    const gananciaPorDia = {}; 
    PRODUCTOS_FALTANTES.clear();

    ventas.forEach((fila) => {
        try {
            const estado = (fila['Estado'] || fila['Estado del paquete'] || "").toLowerCase();
            if (estado.includes('cancel') || estado.includes('devolu')) return;

            const titulo = fila['Título de la publicación'];
            if (!titulo) return;

            // Fechas
            let fechaVenta = new Date();
            const rawFecha = fila['Fecha de venta'] || fila['Fecha'];
            if (rawFecha) {
                if (typeof rawFecha === 'number') {
                    fechaVenta = new Date(Math.round((rawFecha - 25569)*86400*1000));
                } else if (typeof rawFecha === 'string') {
                    if (rawFecha.includes('/')) {
                        const partes = rawFecha.split(' ')[0].split('/'); 
                        if (partes.length === 3) fechaVenta = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
                    } else fechaVenta = new Date(rawFecha);
                }
            }
            if (isNaN(fechaVenta.getTime())) fechaVenta = new Date();

            // Costos logic
            let costoUnitario = 0;
            let uiCosto = `<span class="badge badge-warning">Sin Costo</span>`;
            const historial = MEMORIA_PRECIOS[titulo];
            
            if (historial) {
                const costoEncontrado = historial.find(c => new Date(c.fecha_vigencia) <= fechaVenta);
                const costoFinal = costoEncontrado ? costoEncontrado : historial[historial.length - 1];
                costoUnitario = parseFloat(costoFinal.costo_compra);
                uiCosto = `<span class="text-muted">$${costoUnitario.toLocaleString()}</span>`;
            } else {
                PRODUCTOS_FALTANTES.add(titulo);
            }

            // Cálculos
            const cantidad = parseFloat(fila['Unidades'] || 1);
            const precioUnit = parseFloat(fila['Precio unitario de venta de la publicación (ARS)'] || 0);
            const ventaBruta = precioUnit * cantidad;

            let gastosML = 0;
            ['Cargo por venta', 'Costo de envío', 'Costos de envío (ARS)', 'Impuestos', 'Retención de IIBB'].forEach(col => {
                if (fila[col]) gastosML += Math.abs(parseFloat(fila[col]));
            });

            const costoTotalMerca = costoUnitario * cantidad;
            const gananciaNeta = ventaBruta - gastosML - costoTotalMerca;

            totales.venta += ventaBruta;
            totales.ml += gastosML;
            totales.costo += costoTotalMerca;
            totales.ganancia += gananciaNeta;

            const keyFecha = fechaVenta.toISOString().split('T')[0];
            gananciaPorDia[keyFecha] = (gananciaPorDia[keyFecha] || 0) + gananciaNeta;

            // Guardar arrays
            const idVenta = fila['Número de venta'] || fila['Venta'] || fila['# de venta'];
            if (idVenta) {
                DATOS_PARA_BD.push({
                    id_venta: idVenta.toString(),
                    fecha: keyFecha,
                    producto: titulo,
                    cantidad: cantidad,
                    venta_bruta: ventaBruta,
                    costos_ml: gastosML, 
                    costo_mercaderia: costoTotalMerca,
                    ganancia_neta: gananciaNeta
                });
            }

            DATOS_PARA_EXPORTAR.push({
                "Fecha": fechaVenta.toLocaleDateString(),
                "Producto": titulo,
                "Venta Bruta ($)": ventaBruta,
                "Costos ML ($)": gastosML * -1,
                "Costo Mercadería ($)": costoTotalMerca * -1,
                "Ganancia Neta ($)": gananciaNeta
            });

            // UI Tabla
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-size:0.85em">${fechaVenta.toLocaleDateString()}</td>
                <td style="font-size:0.9em; max-width:250px;"><b>${titulo}</b></td>
                <td>$${ventaBruta.toLocaleString()}</td>
                <td class="text-danger">-$${gastosML.toLocaleString()}</td>
                <td><div class="text-danger">-$${costoTotalMerca.toLocaleString()}</div>${uiCosto}</td>
                <td class="${gananciaNeta >= 0 ? 'text-success' : 'text-danger'}" style="font-weight:bold">$${gananciaNeta.toLocaleString()}</td>
            `;
            tbody.appendChild(tr);

        } catch (errFila) { console.warn("Fila ignorada"); }
    });

    actualizarDashboard(totales);
    renderizarGrafico(gananciaPorDia);
    actualizarBotonMagico();

    if (DATOS_PARA_EXPORTAR.length > 0) {
        document.getElementById('btnExportar').style.display = 'inline-block';
        document.getElementById('btnGuardarNube').style.display = 'inline-block';
    }
}

// Función 1: Solo abre el modal (Reemplaza a la anterior borrarDatos)
function borrarDatos() {
    // Ya no usamos confirm(), solo abrimos el modal
    document.getElementById('modalConfirmarBorrar').classList.add('open');
}

// Función 2: Cierra el modal sin hacer nada
function cancelarBorrado() {
    document.getElementById('modalConfirmarBorrar').classList.remove('open');
}

// Función 3: Ejecuta la lógica real (La que estaba antes dentro del if)
function confirmarBorrado() {
    localStorage.removeItem('ml_ventas_temp');
    
    // Resetear variables
    DATOS_PARA_BD = [];
    DATOS_PARA_EXPORTAR = [];
    PRODUCTOS_FALTANTES.clear();
    if (myChart) myChart.destroy();
    
    // Resetear UI
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('cardUpload').style.display = 'block'; 
    document.getElementById('inputExcel').value = ''; 
    
    // Cerrar el modal
    cancelarBorrado();
}

// Cerrar modal si hacen click afuera (Overlay)
document.getElementById('modalConfirmarBorrar')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalConfirmarBorrar') cancelarBorrado();
});

function actualizarDashboard(t) {
    document.getElementById('totalVentas').innerText = `$${t.venta.toLocaleString()}`;
    document.getElementById('totalCostosML').innerText = `-$${t.ml.toLocaleString()}`;
    document.getElementById('totalCostoMercaderia').innerText = `-$${t.costo.toLocaleString()}`;
    document.getElementById('totalGanancia').innerText = `$${t.ganancia.toLocaleString()}`;
    
    const margen = t.venta > 0 ? ((t.ganancia / t.venta) * 100).toFixed(1) : 0;
    const uiMargen = document.getElementById('totalMargen');
    uiMargen.innerText = `${margen}%`;
    uiMargen.parentElement.className = `metric-box ${margen > 15 ? 'metric-ganancia' : (margen > 0 ? 'badge-warning' : 'text-danger')}`;
}

function renderizarGrafico(dataDias) {
    const ctx = document.getElementById('chartVentas').getContext('2d');
    const fechas = Object.keys(dataDias).sort();
    const valores = fechas.map(f => dataDias[f]);
    const labels = fechas.map(f => { const p = f.split('-'); return `${p[2]}/${p[1]}`; });

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ganancia Neta ($)',
                data: valores,
                backgroundColor: valores.map(v => v >= 0 ? '#10b981' : '#ef4444'),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function actualizarBotonMagico() {
    const btn = document.getElementById('alertContainer');
    const cant = PRODUCTOS_FALTANTES.size;
    document.getElementById('countFaltantes').innerText = cant;
    btn.style.display = cant > 0 ? 'block' : 'none';
}

function abrirModalFaltantes() {
    const lista = document.getElementById('listaFaltantes');
    lista.innerHTML = ''; 
    PRODUCTOS_FALTANTES.forEach(nombre => {
        const li = document.createElement('li');
        li.className = 'missing-item';
        li.innerHTML = `<span title="${nombre}">${nombre}</span><a href="admin.html?producto=${encodeURIComponent(nombre)}" target="_blank" class="btn-fix">Cargar Precio ➜</a>`;
        lista.appendChild(li);
    });
    document.getElementById('modalFaltantes').classList.add('open');
}

function cerrarModalFaltantes() {
    document.getElementById('modalFaltantes').classList.remove('open');
}

document.getElementById('modalFaltantes')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalFaltantes') cerrarModalFaltantes();
});

function descargarReporte() {
    if (DATOS_PARA_EXPORTAR.length === 0) return alert("Nada para exportar");
    const ws = XLSX.utils.json_to_sheet(DATOS_PARA_EXPORTAR);
    ws['!cols'] = [{wch: 12}, {wch: 60}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rentabilidad");
    XLSX.writeFile(wb, `Reporte_Rentabilidad_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function guardarEnNube() {
    if (DATOS_PARA_BD.length === 0) return alert("Nada para guardar.");
    const btn = document.getElementById('btnGuardarNube');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "⏳ Guardando...";

    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            alert("Inicia sesión primero.");
            window.open('login.html', '_blank');
            throw new Error("No autenticado");
        }
        const { error } = await db.from('ventas').upsert(DATOS_PARA_BD, { onConflict: 'id_venta' });
        if (error) throw error;
        alert(`✅ Guardadas ${DATOS_PARA_BD.length} ventas.`);
        btn.style.display = 'none';
    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}