import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import { pool } from "./config/db.js"
import authRoutes from "./routes/authRoutes.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);




//test route
app.get('/', (req, res) => {
  res.json({ message: 'Splitewise API is working!' })
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

