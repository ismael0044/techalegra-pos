const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👉 LÍNEA CLAVE: Permite que Express sirva los archivos HTML/CSS/JS de la carpeta del proyecto
app.use(express.static(__dirname));

// Configuración de Sesiones
app.use(session({
  secret: 'clave_secreta_super_segura_techalegra',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Conexión a la base de datos MySQL (XAMPP local)
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // En XAMPP por defecto la contraseña viene vacía
  database: 'techalegra_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ==========================================
// RUTA DE AUTENTICACIÓN (LOGIN)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ success: false, message: 'Por favor ingresa usuario y contraseña' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }

    const user = rows[0];

    // Verificar si la contraseña está encriptada (bcrypt) o en texto plano ("1234")
    let passwordMatch = false;
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
    }

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }

    // Guardar datos del usuario en la sesión
    req.session.usuario = {
      id: user.id,
      nombre: user.nombre,
      usuario: user.usuario,
      rol: user.rol
    };

    res.json({
      success: true,
      message: '¡Inicio de sesión exitoso!',
      usuario: req.session.usuario
    });

  } catch (err) {
    res.status(500).json({ success: false, error: 'Error en el servidor al iniciar sesión', details: err.message });
  }
});

// Ruta para cerrar sesión
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
    }
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  });
});

// Ruta para verificar si hay una sesión activa
app.get('/api/session', (req, res) => {
  if (req.session && req.session.usuario) {
    res.json({ loggedIn: true, usuario: req.session.usuario });
  } else {
    res.json({ loggedIn: false });
  }
});

// ==========================================
// RUTAS DE PRODUCTOS Y VENTAS
// ==========================================

// Ruta 1: Obtener todo el inventario desde MySQL
app.get('/api/productos', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, codigo AS code, nombre AS name, categoria AS category, ubicacion AS location, numero_serie AS sn, stock, precio_unitario AS price FROM productos ORDER BY id DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar productos', details: err.message });
  }
});

// Ruta 2: Registrar un producto individual manualmente
app.post('/api/productos', async (req, res) => {
  const { codigo, nombre, categoria, stock, price, ubicacion, sn } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO productos (codigo, nombre, categoria, stock, precio_unitario, ubicacion, numero_serie) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo, nombre, categoria || 'General', stock || 0, price || 0, ubicacion || 'ALMACEN', sn || 'N/A']
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Error al insertar producto', details: err.message });
  }
});

// Ruta 3: Importación masiva desde Excel
app.post('/api/productos/importar', async (req, res) => {
  const productos = req.body;
  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'Datos no válidos' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const p of productos) {
      await connection.query(
        `INSERT INTO productos (codigo, nombre, categoria, stock, precio_unitario, ubicacion, numero_serie) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.code, p.name, p.category || 'General', p.stock || 0, p.price || 0, p.location || 'ALMACEN', p.sn || 'N/A']
      );
    }

    await connection.commit();
    res.json({ success: true, count: productos.length });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: 'Error en importación masiva', details: err.message });
  } finally {
    connection.release();
  }
});

// Ruta 4: Registrar Venta POS y descontar stock automáticamente en MySQL
app.post('/api/ventas', async (req, res) => {
  const { cliente, subtotal, itbis, total, items } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [ventaRes] = await connection.query(
      `INSERT INTO ventas (cliente_nombre, subtotal, itbis, total) VALUES (?, ?, ?, ?)`,
      [cliente || 'Cliente General', subtotal, itbis, total]
    );
    const ventaId = ventaRes.insertId;

    for (const item of items) {
      await connection.query(
        `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, total_linea) 
         VALUES (?, ?, ?, ?, ?)`,
        [ventaId, item.id, item.qty, item.price, item.price * item.qty]
      );

      // Descontar inventario en MySQL
      await connection.query(
        `UPDATE productos SET stock = GREATEST(0, stock - ?) WHERE id = ?`,
        [item.qty, item.id]
      );
    }

    await connection.commit();
    res.json({ success: true, ventaId });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: 'Error procesando venta', details: err.message });
  } finally {
    connection.release();
  }
});

// Ruta 5: Eliminar un producto de la base de datos MySQL
app.delete('/api/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM productos WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado' });
    }
    res.json({ success: true, message: 'Producto eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar el producto', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor TechAlegra ejecutándose en http://localhost:${PORT}`);
});