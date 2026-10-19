// --- ESTADO INICIAL DEL SISTEMA ---
const API_URL = 'http://localhost:3000/api';

let inventory = [];
let cart = [];
let pendingExcelData = [];

document.addEventListener('DOMContentLoaded', () => {
  loadInventoryFromDB();
});

// --- CARGAR INVENTARIO DESDE MYSQL ---
async function loadInventoryFromDB() {
  try {
    const response = await fetch(`${API_URL}/productos`);
    if (response.ok) {
      const data = await response.json();
      // Mapeamos para asegurar que coincida con la estructura que usa tu app
      inventory = data.map(item => ({
        uniqueId: `ROW-${item.id}-${item.code}`,
        id: item.id,
        code: item.code,
        name: item.name,
        category: item.category || 'General',
        stock: item.stock,
        price: Number(item.price),
        location: item.location || 'ALMACEN',
        sn: item.sn || 'N/A'
      }));
      renderInventory();
      renderPOSGrid();
    }
  } catch (error) {
    console.error("Error al conectar con la base de datos MySQL:", error);
  }
}

function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const targetTab = document.getElementById('tab-' + tabId);
  if (targetTab) targetTab.classList.remove('hidden');
}

function clearSearch() {
  const searchInput = document.getElementById('inventory-search');
  if (searchInput) searchInput.value = '';
  renderInventory();
}

function setFilterStatus(status) {
  const select = document.getElementById('status-filter-select');
  if (select) select.value = status;
  renderInventory();
}

function normalizeStr(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// --- RENDERIZAR TABLA CON BÚSQUEDA Y FILTRADO ---
function renderInventory() {
  const tbody = document.getElementById('inventory-list');
  if (!tbody) return;

  const rawSearch = document.getElementById('inventory-search')?.value || '';
  const searchTerm = normalizeStr(rawSearch);
  const statusFilter = document.getElementById('status-filter-select')?.value || 'all';

  let countAvailable = 0, countLow = 0, countOut = 0;

  inventory.forEach(item => {
    if (item.stock === 0) countOut++;
    else if (item.stock <= 3) countLow++;
    else countAvailable++;
  });

  const countAllEl = document.getElementById('count-all');
  const countAvailEl = document.getElementById('count-available');
  const countLowEl = document.getElementById('count-low');
  const countOutEl = document.getElementById('count-out');

  if (countAllEl) countAllEl.innerText = inventory.length;
  if (countAvailEl) countAvailEl.innerText = countAvailable;
  if (countLowEl) countLowEl.innerText = countLow;
  if (countOutEl) countOutEl.innerText = countOut;

  // Filtrar productos
  const filteredItems = inventory.filter(item => {
    const itemCode = normalizeStr(item.code);
    const itemName = normalizeStr(item.name);
    const itemCat  = normalizeStr(item.category);
    const itemSN   = normalizeStr(item.sn);
    const itemLoc  = normalizeStr(item.location);

    const matchesSearch = searchTerm === '' || 
      itemName.includes(searchTerm) ||
      itemCode.includes(searchTerm) ||
      itemCat.includes(searchTerm) ||
      itemSN.includes(searchTerm) ||
      itemLoc.includes(searchTerm);

    let matchesStatus = true;
    if (statusFilter === 'available') matchesStatus = item.stock >= 4;
    else if (statusFilter === 'low') matchesStatus = item.stock > 0 && item.stock <= 3;
    else if (statusFilter === 'out') matchesStatus = item.stock === 0;

    return matchesSearch && matchesStatus;
  });

  if (filteredItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-slate-400">
          <i class="fa-solid fa-magnifying-glass text-2xl mb-2"></i>
          <p>${inventory.length === 0 ? 'El inventario está vacío. Ve a <b>Importar Excel</b> para cargar tu archivo.' : 'No se encontraron productos para: "<b>' + rawSearch + '</b>"'}</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredItems.map(item => {
    let statusBadge = '';
    if (item.stock === 0) {
      statusBadge = `<span class="bg-red-100 text-red-700 text-xs font-extrabold px-2.5 py-1 rounded-full border border-red-200 inline-flex items-center">
                      <i class="fa-solid fa-circle-xmark mr-1"></i> Agotado
                    </span>`;
    } else if (item.stock <= 3) {
      statusBadge = `<span class="bg-amber-100 text-amber-800 text-xs font-extrabold px-2.5 py-1 rounded-full border border-amber-200 inline-flex items-center">
                      <i class="fa-solid fa-triangle-exclamation mr-1"></i> Quedan ${item.stock} unids
                    </span>`;
    } else {
      statusBadge = `<span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-200 inline-flex items-center">
                      <i class="fa-solid fa-circle-check mr-1"></i> Disponible (${item.stock})
                    </span>`;
    }

    const isAddDisabled = item.stock === 0 ? 'disabled opacity-40 cursor-not-allowed' : '';

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-semibold text-indigo-900">${item.code}</td>
        <td class="p-3 font-medium">${item.name} <br><span class="text-xs text-slate-400">S/N: ${item.sn || 'N/A'}</span></td>
        <td class="p-3"><span class="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded-md border">${item.category}</span></td>
        <td class="p-3 text-center">${statusBadge}</td>
        <td class="p-3 text-right font-bold text-slate-700">$${item.price.toFixed(2)}</td>
        <td class="p-3 text-slate-500">${item.location}</td>
        <td class="p-3 text-center">
          <button onclick="addToCart('${item.uniqueId}')" ${isAddDisabled} class="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 p-2 rounded-lg text-xs font-semibold">
            <i class="fa-solid fa-cart-plus"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// --- PROCESAR E IMPORTAR EXCEL ---
function processExcelFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });

    const sheetName = workbook.SheetNames.includes("MIL-Inventory") ? "MIL-Inventory" : workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (!rows || rows.length === 0) {
      alert("El archivo Excel está vacío.");
      return;
    }

    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const rowStr = rows[i].map(c => normalizeStr(c)).join(" ");
      if (rowStr.includes("codigo") && rowStr.includes("descripcion")) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      alert("No se encontró la fila de columnas en el archivo Excel.");
      return;
    }

    const headers = rows[headerRowIndex].map(h => normalizeStr(h));
    
    const colCode  = headers.findIndex(h => h.includes("codigo"));
    const colDesc  = headers.findIndex(h => h.includes("descripcion"));
    const colCat   = headers.findIndex(h => h.includes("categoria"));
    const colBrand = headers.findIndex(h => h.includes("marca"));
    const colModel = headers.findIndex(h => h.includes("modelo"));
    const colSN    = headers.findIndex(h => h.includes("serial") || h.includes("s/n"));
    const colLoc   = headers.findIndex(h => h.includes("ubicacion"));
    const colQty   = headers.findIndex(h => h.includes("cantidad"));
    const colCost  = headers.findIndex(h => h.includes("costo") || h.includes("precio"));

    const cleanedData = [];

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const code   = colCode !== -1 && row[colCode] !== undefined && row[colCode] !== "" ? row[colCode].toString().trim() : `ITEM-${i}`;
      const desc   = colDesc !== -1 && row[colDesc] !== undefined ? row[colDesc].toString().trim() : "";
      const brand  = colBrand !== -1 && row[colBrand] !== undefined ? row[colBrand].toString().trim() : "";
      const model  = colModel !== -1 && row[colModel] !== undefined ? row[colModel].toString().trim() : "";
      const cat    = colCat !== -1 && row[colCat] !== undefined ? row[colCat].toString().trim() : "General";
      const sn     = colSN !== -1 && row[colSN] !== undefined ? row[colSN].toString().trim() : "UNKNOWN";
      const loc    = colLoc !== -1 && row[colLoc] !== undefined ? row[colLoc].toString().trim() : "ALMACEN";
      
      const stock  = colQty !== -1 && row[colQty] !== undefined ? (parseInt(row[colQty]) || 0) : 0;
      const price  = colCost !== -1 && row[colCost] !== undefined ? (parseFloat(row[colCost].toString().replace(/[^0-9.-]+/g, "")) || 0) : 0;

      let fullName = desc;
      if (brand && brand.toUpperCase() !== "UNKNOWN" && brand !== "") fullName = `${brand} ${fullName}`;
      if (model && model.toUpperCase() !== "UNKNOWN" && model !== "") fullName = `${fullName} (${model})`;

      const isTotal = desc.toUpperCase().includes("TOTAL") || code.toUpperCase().includes("TOTAL");

      if ((code !== "" || desc !== "") && !isTotal) {
        cleanedData.push({
          code: code,
          name: fullName || 'Producto sin descripción',
          category: cat || 'General',
          stock: stock,
          price: price,
          location: loc || 'ALMACEN',
          sn: sn || 'N/A'
        });
      }
    }

    if (cleanedData.length === 0) {
      alert("No se encontraron registros válidos en las filas de datos.");
      return;
    }

    pendingExcelData = cleanedData;
    displayImportPreview(pendingExcelData);
  };

  reader.readAsArrayBuffer(file);
}

function displayImportPreview(data) {
  document.getElementById('import-preview-card').classList.remove('hidden');
  document.getElementById('preview-count').innerText = data.length;

  const previewBody = document.getElementById('import-preview-table');
  previewBody.innerHTML = data.map(item => `
    <tr>
      <td class="p-2 font-bold text-indigo-700">${item.code}</td>
      <td class="p-2">${item.name}</td>
      <td class="p-2">${item.category}</td>
      <td class="p-2 text-center font-semibold">${item.stock}</td>
      <td class="p-2 text-right font-bold">$${item.price.toFixed(2)}</td>
    </tr>
  `).join('');
}

// --- GUARDAR EXCEL DIRECTAMENTE EN MYSQL ---
async function confirmExcelImport() {
  if (pendingExcelData.length === 0) return;

  try {
    const response = await fetch(`${API_URL}/productos/importar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingExcelData)
    });

    const data = await response.json();
    if (data.success) {
      alert(`¡Éxito! Se han guardado ${data.count} productos de forma permanente en MySQL.`);
      pendingExcelData = [];
      document.getElementById('import-preview-card').classList.add('hidden');
      
      const searchInput = document.getElementById('inventory-search');
      if (searchInput) searchInput.value = '';
      
      const filterSelect = document.getElementById('status-filter-select');
      if (filterSelect) filterSelect.value = 'all';

      await loadInventoryFromDB(); // Recargar desde la base de datos real
      showTab('inventory');
    } else {
      alert("Error al importar: " + (data.error || 'Desconocido'));
    }
  } catch (error) {
    alert("Error de conexión con el servidor backend: " + error.message);
  }
}

// --- POS Y FACTURACIÓN ---
function renderPOSGrid() {
  const grid = document.getElementById('pos-products-grid');
  if (!grid) return;

  grid.innerHTML = inventory.slice(0, 30).map(item => {
    const isOutOfStock = item.stock === 0;
    const disabledClass = isOutOfStock ? 'opacity-50 pointer-events-none bg-slate-100' : 'hover:border-indigo-500 cursor-pointer';
    
    return `
      <div onclick="${isOutOfStock ? '' : `addToCart('\${item.uniqueId}')`}" class="bg-white p-3 rounded-xl border border-slate-200 transition ${disabledClass}">
        <div class="flex justify-between items-center">
          <span class="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${item.category}</span>
          ${isOutOfStock ? '<span class="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">AGOTADO</span>' : ''}
        </div>
        <h4 class="font-bold text-slate-800 text-sm mt-1">${item.name}</h4>
        <div class="flex justify-between items-center mt-2">
          <span class="text-xs ${item.stock <= 3 ? 'text-amber-600 font-bold' : 'text-slate-400'}">Stock: ${item.stock}</span>
          <span class="font-extrabold text-indigo-600 text-sm">$${item.price.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function addToCart(uniqueId) {
  const prod = inventory.find(i => i.uniqueId === uniqueId);
  if (!prod || prod.stock === 0) return;

  const existing = cart.find(c => c.uniqueId === uniqueId);
  if (existing) {
    if (existing.qty < prod.stock) {
      existing.qty++;
    } else {
      alert(`Límite alcanzado: solo hay ${prod.stock} unidades en inventario.`);
    }
  } else {
    cart.push({ ...prod, qty: 1 });
  }
  renderCart();
}

function renderCart() {
  const cartContainer = document.getElementById('cart-items');
  if (!cartContainer) return;

  if (cart.length === 0) {
    cartContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">No hay ítems en la factura</p>`;
    updateTotals(0);
    return;
  }

  let subtotal = 0;
  cartContainer.innerHTML = cart.map(item => {
    const itemTotal = item.price * item.qty;
    subtotal += itemTotal;
    return `
      <div class="flex justify-between items-center bg-slate-50 p-2 rounded border text-xs">
        <div>
          <p class="font-bold text-slate-800">${item.name}</p>
          <p class="text-slate-400">$${item.price.toFixed(2)} x ${item.qty}</p>
        </div>
        <p class="font-bold text-indigo-600">$${itemTotal.toFixed(2)}</p>
      </div>
    `;
  }).join('');

  updateTotals(subtotal);
}

function updateTotals(subtotal) {
  const tax = subtotal * 0.18;
  const total = subtotal + tax;

  document.getElementById('pos-subtotal').innerText = `$${subtotal.toFixed(2)}`;
  document.getElementById('pos-tax').innerText = `$${tax.toFixed(2)}`;
  document.getElementById('pos-total').innerText = `$${total.toFixed(2)}`;
}

// --- PROCESAR VENTA Y DESCONTAR STOCK EN MYSQL ---
async function printTicket() {
  if (cart.length === 0) {
    alert("Agrega productos a la factura primero.");
    return;
  }

  const customer = document.getElementById('customer-name').value || 'Cliente General';
  let subtotal = 0;

  cart.forEach(item => {
    subtotal += item.price * item.qty;
  });

  const tax = subtotal * 0.18;
  const total = subtotal + tax;

  // Preparar los items para enviarlos al backend
  const salePayload = {
    cliente: customer,
    subtotal: subtotal,
    itbis: tax,
    total: total,
    items: cart.map(item => ({
      id: item.id,
      qty: item.qty,
      price: item.price
    }))
  };

  try {
    const response = await fetch(`${API_URL}/ventas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salePayload)
    });

    const data = await response.json();
    if (data.success) {
      // Mostrar ticket en pantalla para imprimir
      const receiptBody = document.getElementById('receipt-items');
      receiptBody.innerHTML = cart.map(item => {
        const itemTotal = item.price * item.qty;
        return `
          <tr><td colspan="2" class="pt-1"><b>${item.name}</b></td></tr>
          <tr><td>${item.qty} x $${item.price.toFixed(2)}</td><td class="text-right">$${itemTotal.toFixed(2)}</td></tr>
        `;
      }).join('');

      document.getElementById('receipt-customer').innerText = customer;
      document.getElementById('receipt-date').innerText = new Date().toLocaleString();
      document.getElementById('receipt-total').innerText = `$${total.toFixed(2)}`;

      window.print();

      // Limpiar carrito y recargar inventario actualizado desde MySQL
      cart = [];
      renderCart();
      await loadInventoryFromDB();
    } else {
      alert("Error al procesar la venta: " + (data.error || 'Desconocido'));
    }
  } catch (error) {
    alert("Error de conexión al registrar la venta: " + error.message);
  }
}