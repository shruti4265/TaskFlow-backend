import pg from "pg";
import "dotenv/config";
const db=new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
db.connect();
export default db;