import express from "express";
import cors from "cors";
import db from "./db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import auth from "./auth.js";
import "dotenv/config";

const app=express();
app.use(express.json());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.FRONTEND_URL?.replace(/\/$/, '');
    if (!origin || origin.replace(/\/$/, '') === allowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.get("/",(req,res)=>{
    res.send("Welcome to Task Flow");
});
app.post("/register",async (req,res)=>{
    try{
        const{name,email,password}=req.body;
        const userCheck=await db.query(`SELECT * FROM users where email=$1`,[email]);
        if(userCheck.rows.length>0){
            return res.status(400).json({message:"User already exist, try signing in"});
        }
        const salt = await bcrypt.genSalt(10);
        const hashedpassword = await bcrypt.hash(password,salt);
        const result=await db.query("INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3) RETURNING id",[name,email,hashedpassword]);
        const userID=result.rows[0].id;
        const profilePicNumber = result.rows[0].profile_pic || '10'; // 1, 2, or 3
        const token=jwt.sign(
            {id:userID,username:name,email:email},
            process.env.JWT_SECRET,
            {expiresIn:"7d"}
        );
        res.status(200).json({message:"User registered sucessfully",token,user:{id:userID,username:name,email:email,profile_pic:profilePicNumber}});
    }catch(err){
        console.log(err);
        res.status(500).json({message:"Error signing up"});
    }
})
app.post("/login", async (req,res)=>{
    try{
        const {email,password}=req.body;
        const usercheck=await db.query(`SELECT * FROM users where email=$1`,[email]);
        if(usercheck.rows.length === 0){
            return res.status(400).json({message:"Email not found try signing up"});
        }
        const user = usercheck.rows[0];
        const isPasswordValid=await bcrypt.compare(password,user.password_hash);
        if(!isPasswordValid){
            return res.status(400).json({message:"Invalid Password"});
        }
        const token =jwt.sign(
            {id:user.id,username:user.username,email:user.email},
            process.env.JWT_SECRET,
            {expiresIn:"1h"}
        );
        res.status(200).json({message:"sign in successful",token,user:{id:user.id,username:user.username,email:user.email,profile_pic:user.profile_pic}});
    }catch(err){
        console.log(err);
        res.status(500).json({message:"Error signing in"});
    }
});
app.get("/boards", auth, async (req, res) => {
    try {
        const userID = req.user.id;
        const result = await db.query(
            `SELECT b.*, COUNT(c2.id) AS tasks
            FROM boards b
            LEFT JOIN "columns" col ON col.board_id = b.id
            LEFT JOIN cards c2 ON c2.column_id = col.id
            WHERE b.user_id = $1
            GROUP BY b.id`,
        [userID]
    );
        res.status(200).json({ message: "Boards fetched successfully", boards: result.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error fetching boards" });
    }
});
app.post("/boards", auth, async (req, res) => {
    try {
        const userID = req.user.id;
        const { title } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ message: "Title is required" });
        }

        const result = await db.query(
            "INSERT INTO boards (user_id, title) VALUES ($1, $2) RETURNING *",
            [userID, title.trim()]
        );
        const boardID = result.rows[0].id;
        await db.query(
            `INSERT INTO columns (board_id, name, position) VALUES 
            ($1, 'To Do', 0),
            ($1, 'In Progress', 1),
            ($1, 'Done', 2)`,
            [boardID]
        );

        res.status(201).json({ message: "Board created successfully", board: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error creating board" });
    }
});
app.get("/boards/count", auth, async (req, res) => {
    try {
        const userID = req.user.id;
        const result = await db.query("SELECT COUNT(*) FROM boards WHERE user_id=$1", [userID]);
        res.status(200).json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error fetching board count" });
    }
});
app.get("/boards/:id", auth, async (req, res) => {
    try {
        const userID = req.user.id;

        const result = await db.query(
            "SELECT * FROM boards WHERE id=$1 AND user_id=$2",
            [req.params.id, userID]
        );
        const result2 = await db.query(
            "SELECT c.* FROM columns c LEFT JOIN boards b ON b.id=c.board_id WHERE c.board_id=$1 ORDER BY c.position",
            [req.params.id]
        );
        const result3 = await db.query(
            "SELECT c.*,COUNT(c.id) as tasks FROM boards b LEFT JOIN columns col ON b.id=col.board_id LEFT JOIN cards c ON c.column_id=col.id WHERE b.id=$1 GROUP BY c.id ORDER BY c.position",
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Board not found"
            });
        }

        res.status(200).json({
            message: "Board fetched successfully",
            board: result.rows[0],
            column: result2.rows,
            cards: result3.rows
        });

    } catch (err) {
        console.log(err);

        res.status(500).json({
            message: "Error fetching board"
        });
    }
});
app.post("/cards/:id",auth,async(req,res)=>{
    try{
        const columnID=req.params.id;
        const {title,description,priority,dueDate}=req.body;
        const positionResult=await db.query("SELECT MAX(position) FROM cards WHERE column_id=$1",[columnID]);
        const position=positionResult.rows[0].max !== null ? positionResult.rows[0].max + 1 : 0;
        const result = await db.query("INSERT INTO cards (column_id,title,description,priority,due_date,position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [columnID,title,description,priority,dueDate,position]);
        res.status(201).json({message:"Card created successfully",card:result.rows[0]});
    }catch(err){
        console.log(err);
        res.status(500).json({message:"Error creating card"});
    }
});
app.delete("/boards/:id", auth, async (req, res) => {
    try {
        const userID = req.user.id;
        const boardID = req.params.id;

        // check board exists first
        const check = await db.query("SELECT * FROM boards WHERE id=$1 AND user_id=$2", [boardID, userID]);
        if (check.rows.length === 0) {
            return res.status(404).json({ message: "Board not found" });
        }

        // delete in correct order: cards → columns → boards
        await db.query("DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE board_id=$1)", [boardID]);
        await db.query("DELETE FROM columns WHERE board_id=$1", [boardID]);
        await db.query("DELETE FROM boards WHERE id=$1 AND user_id=$2", [boardID, userID]);

        res.status(200).json({ message: "Board deleted successfully" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error deleting board" });
    }
});
app.delete("/cards/:id", auth, async (req, res) => {
    try{
        const id=req.params.id;
        const userID=req.user.id;
        const check=await db.query(`SELECT * FROM cards c LEFT JOIN columns col ON c.column_id=col.id LEFT JOIN boards b ON col.board_id=b.id WHERE c.id=$1 AND b.user_id=$2`,[id,userID]);
        if(check.rows.length===0){
            return res.status(404).json({message:"Card not found"});
        }
        await db.query("DELETE FROM cards WHERE id=$1",[id]);
        res.status(200).json({message:"Card deleted successfully"});
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error deleting card" });
    }
});
app.put("/users/profile-pic", auth, async (req, res) => {
    try{
        const userID = req.user.id;
        const {profile_pic} = req.body;
        if(!profile_pic || !['1','2','3','4','5','6','7','8','9','10','11','12','13'].includes(profile_pic)){
            return res.status(400).json({message:"Invalid profile picture selection"});
        }
        await db.query("UPDATE users SET profile_pic=$1 WHERE id=$2",[profile_pic,userID]);
        res.status(200).json({message:"Profile picture updated successfully"});
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error updating profile picture" });
    }
});
app.delete("/users/delete", auth, async (req, res) => {
    try {
        const userID = req.user.id;

        // Delete the user
        await db.query("DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE board_id IN (SELECT id FROM boards WHERE user_id=$1))", [userID]);
        await db.query("DELETE FROM columns WHERE board_id IN (SELECT id FROM boards WHERE user_id=$1)", [userID]);
        await db.query("DELETE FROM boards WHERE user_id=$1", [userID]);
        await db.query("DELETE FROM users WHERE id=$1", [userID]);

        res.status(200).json({ message: "Account deleted successfully" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error deleting account" });
    }
});
app.patch("/cards/:id/move", auth, async (req, res) => {
    try {
        const { column_id, position } = req.body;

        // shift cards down in destination column to make room
        await db.query(
            `UPDATE cards SET position = position + 1 
             WHERE column_id = $1 AND position >= $2 AND id != $3`,
            [column_id, position, req.params.id]
        );

        // now place the dragged card
        await db.query(
            "UPDATE cards SET column_id=$1, position=$2 WHERE id=$3",
            [column_id, position, req.params.id]
        );

        res.status(200).json({ message: "Card updated successfully" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Error updating card" });
    }
});

app.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on ${process.env.BACKEND_URL}`);
});