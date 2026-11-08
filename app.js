const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
app.use(express.json());
app.set('json spaces', 2);

const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'books.db');

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(PORT, () => {
      console.log(`Server Running at http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.error(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// Root / Welcome Route
app.get('/', (request, response) => {
  response.send('<h1>Lab 03: REST API, Query Parameters, Validation and Debugging</h1><p><strong>Student:</strong> Rajamoni Naveen (252U1R1210) | <strong>Section:</strong> CSE-2D</p><p>Access the API at <a href="/books">/books</a></p>');
});

// Route 1: GET All Books (with search, filtering, sorting, and pagination)
app.get(['/books', '/books/'], async (request, response) => {
  try {
    const {
      search_q,
      min_price,
      max_price,
      order_by = 'id',
      order = 'ASC',
      limit = 10,
      offset = 0,
    } = request.query;

    const conditions = [];
    const params = [];

    // 1. Partial title search using LIKE
    if (search_q !== undefined) {
      if (typeof search_q !== 'string') {
        return response.status(400).json({ error: 'Invalid search_q. Must be a string.' });
      }
      conditions.push('title LIKE ?');
      params.push(`%${search_q}%`);
    }

    // 2. Price filtering (min_price and max_price)
    if (min_price !== undefined) {
      const isMinEmpty = typeof min_price === 'string' && min_price.trim() === '';
      const min = Number(min_price);
      if (isMinEmpty || !Number.isFinite(min) || min < 0) {
        return response.status(400).json({ error: 'Invalid min_price. Must be a non-negative number.' });
      }
      conditions.push('price >= ?');
      params.push(min);
    }

    if (max_price !== undefined) {
      const isMaxEmpty = typeof max_price === 'string' && max_price.trim() === '';
      const max = Number(max_price);
      if (isMaxEmpty || !Number.isFinite(max) || max < 0) {
        return response.status(400).json({ error: 'Invalid max_price. Must be a non-negative number.' });
      }
      conditions.push('price <= ?');
      params.push(max);
    }

    if (min_price !== undefined && max_price !== undefined && Number(min_price) > Number(max_price)) {
      return response.status(400).json({ error: 'min_price cannot be greater than max_price.' });
    }

    // 3. Sorting validation (whitelist check to prevent SQL injection)
    const validOrderColumns = ['id', 'title', 'author', 'price', 'pages'];
    const formattedOrderBy = String(order_by).toLowerCase();
    if (!validOrderColumns.includes(formattedOrderBy)) {
      return response.status(400).json({
        error: `Invalid order_by column. Allowed values: ${validOrderColumns.join(', ')}`,
      });
    }

    const formattedOrder = String(order).toUpperCase();
    if (formattedOrder !== 'ASC' && formattedOrder !== 'DESC') {
      return response.status(400).json({
        error: 'Invalid order direction. Allowed values: ASC, DESC',
      });
    }

    // 4. Pagination validation
    const isLimitEmpty = typeof limit === 'string' && limit.trim() === '';
    const parsedLimit = Number(limit);
    if (isLimitEmpty || !Number.isInteger(parsedLimit) || parsedLimit < 0) {
      return response.status(400).json({ error: 'Invalid limit. Must be a non-negative integer.' });
    }

    const isOffsetEmpty = typeof offset === 'string' && offset.trim() === '';
    const parsedOffset = Number(offset);
    if (isOffsetEmpty || !Number.isInteger(parsedOffset) || parsedOffset < 0) {
      return response.status(400).json({ error: 'Invalid offset. Must be a non-negative integer.' });
    }

    // 5. Dynamic SQL query construction
    let getBooksQuery = `
      SELECT
        *
      FROM
        book
    `;

    if (conditions.length > 0) {
      getBooksQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    getBooksQuery += ` ORDER BY ${formattedOrderBy} ${formattedOrder} LIMIT ? OFFSET ?;`;
    params.push(parsedLimit, parsedOffset);

    const booksArray = await db.all(getBooksQuery, params);
    response.status(200).json(booksArray);
  } catch (error) {
    response.status(500).json({ error: 'Internal Server Error' });
  }
});

// Route 2: GET Book by ID
app.get('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params;
    const getBookQuery = `
      SELECT
        *
      FROM
        book
      WHERE
        id = ?;
    `;
    const book = await db.get(getBookQuery, [bookId]);
    if (!book) {
      return response.status(404).json({ error: 'Book not found' });
    }
    response.status(200).json(book);
  } catch (error) {
    response.status(500).json({ error: 'Internal Server Error' });
  }
});

// Route 3: POST (Add) Book
app.post('/books/', async (request, response) => {
  try {
    const { title, author, price, pages } = request.body;

    if (!title || !author || price === undefined || pages === undefined) {
      return response.status(400).json({ error: 'All fields (title, author, price, pages) are required' });
    }

    if (typeof price !== 'number' || typeof pages !== 'number' || price < 0 || pages <= 0) {
      return response.status(400).json({ error: 'Price must be a non-negative number and pages must be a positive integer' });
    }

    const addBookQuery = `
      INSERT INTO
        book (title, author, price, pages)
      VALUES
        (?, ?, ?, ?);
    `;
    const result = await db.run(addBookQuery, [title, author, price, pages]);
    response.status(201).json({
      message: 'Book created successfully',
      bookId: result.lastID,
    });
  } catch (error) {
    response.status(500).json({ error: 'Internal Server Error' });
  }
});

// Route 4: PUT (Update) Book
app.put('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params;
    const { title, author, price, pages } = request.body;

    if (!title || !author || price === undefined || pages === undefined) {
      return response.status(400).json({ error: 'All fields (title, author, price, pages) are required' });
    }

    if (typeof price !== 'number' || typeof pages !== 'number' || price < 0 || pages <= 0) {
      return response.status(400).json({ error: 'Price must be a non-negative number and pages must be a positive integer' });
    }

    const updateBookQuery = `
      UPDATE
        book
      SET
        title = ?,
        author = ?,
        price = ?,
        pages = ?
      WHERE
        id = ?;
    `;
    const result = await db.run(updateBookQuery, [title, author, price, pages, bookId]);
    if (result.changes === 0) {
      return response.status(404).json({ error: 'Book not found' });
    }
    response.status(200).json({ message: 'Book updated successfully' });
  } catch (error) {
    response.status(500).json({ error: 'Internal Server Error' });
  }
});

// Route 5: DELETE Book
app.delete('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params;
    const deleteBookQuery = `
      DELETE FROM
        book
      WHERE
        id = ?;
    `;
    const result = await db.run(deleteBookQuery, [bookId]);
    if (result.changes === 0) {
      return response.status(404).json({ error: 'Book not found' });
    }
    response.status(200).json({ message: 'Book deleted successfully' });
  } catch (error) {
    response.status(500).json({ error: 'Internal Server Error' });
  }
});

// 404 Handler for undefined routes
app.use((request, response) => {
  response.status(404).json({
    error: 'Not Found',
    message: `Cannot ${request.method} ${request.url}`,
  });
});

module.exports = app;
