# Café Portal

Café Portal is a student project for STI College Global City. We made it to give students and café staff a simpler way to manage campus food orders.

Customers can browse the menu, add food and drinks to their cart, place orders, check their order history, manage their account, and send support tickets. The project uses HTML, CSS, and JavaScript for the website, with an Express server and SQLite database behind it.

## What you need

- Node.js 18 or newer
- npm

## Running the project

1. Open a terminal in the project folder.
2. Install the project packages:

   ```sh
   npm install
   ```

3. Start the server:

   ```sh
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000) in your browser.

When the server starts, it sets up the database using `schema.sql`. If the menu is empty, it adds a few sample items. By default, the database is `cafe_portal.db` in the project folder.

## Optional settings

You can set these environment variables before starting the server:

| Variable | What it does | Default |
| --- | --- | --- |
| `PORT` | Changes the server port | `3000` |
| `DB_FILE` | Sets the path to the SQLite database | `cafe_portal.db` in the project folder |
| `JWT_SECRET` | Sets the secret used for login tokens | A randomly generated secret |

Set `JWT_SECRET` to a private, persistent value if you want login sessions to stay valid after restarting the server. Keep secrets and local database files out of commits.

## A few things to know

- People can create customer accounts through the website. Staff accounts need to be set up separately.
- The selected payment method is saved with each order, but the project does not process payments.
- The database tables are defined in `schema.sql` and are set up automatically when the server starts.
