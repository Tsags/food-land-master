import express from "express";
import User from "../models/User.js";
import Order from "../models/Order.js";
import Customer from "../models/Customer.js";
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import { protectRoute, admin } from "../authenticateMiddleware/authMiddleware.js";
import pkg from "crypto-js";
const { SHA256, enc } = pkg;

const userRoutes = express.Router();

//TODO: redefine expiresIn
const genToken = (id) => {
  return jwt.sign({ id }, process.env.TOKEN_SECRET, { expiresIn: "60d" });
};

function generateHash(data) {
  const hash = SHA256(data);
  return hash.toString(enc.Hex);
}

const loginUser = asyncHandler(async (req, res) => {
  const { name, password } = req.body;
  const user = await User.findOne({ name });

  if (user && (await user.matchPasswords(password))) {
    const fingerprint =
      req.headers["user-agent"] +
      req.headers["accept-language"] +
      req.headers["accept-encoding"] +
      req.headers["accept"] +
      req.headers["connection"];
    const customerId = generateHash(fingerprint);
    let customer = await Customer.findOne({ customerId });

    if (!customer) {
      // Create a new customer entry if it doesn't exist
      customer = await Customer.create({ customerId: customerId, session: [{ table: name }] });
    } else {
      // Check if the desired session exists
      const sessionExists = customer.session.some((s) => s.table === name);

      if (!sessionExists) {
        // Create a new session object in the session array
        customer.session.push({ table: name, items: [], otherCustomers: [] });
        await customer.save();
      }
    }

    // Set the customerId cookie in the response
    res.cookie("customerId", customerId, {
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Cookie expiration (30 days)
      httpOnly: true, // Make the cookie inaccessible from JavaScript
      // secure: true, // Serve the cookie only over HTTPS if your application uses SSL/TLS
      sameSite: "none",
    });

    const customerIdFromCookie = req.cookies.customerId;

    const otherCustomers = await Customer.find({
      customerId: { $ne: customerIdFromCookie },
      "session.table": { $eq: name },
      isPresent: true,
    });

    otherCustomers.forEach((otherCustomer) => {
      const otherCustomerId = otherCustomer.customerId;

      const existingCustomer = customer.session.find((s) => s.table === name);
      if (
        existingCustomer &&
        !existingCustomer.otherCustomers.some((item) => item.otherCustomerId === otherCustomerId)
      ) {
        existingCustomer.otherCustomers.push({ otherCustomerId: otherCustomerId });
        customer.save();
      }

      const session = otherCustomer.session.find((s) => s.table === name);
      if (session && !session.otherCustomers.some((item) => item.otherCustomerId === customerIdFromCookie)) {
        session.otherCustomers.push({ otherCustomerId: customerIdFromCookie });
        otherCustomer.save();
      }
    });

    res.json({
      _id: user._id,
      name: user.name,
      isAdmin: user.isAdmin,
      token: genToken(user._id),
      customerId: customerId,
    });
  } else {
    res.status(401);
    throw new Error("Invalid something.");
  }
});

const registerUser = asyncHandler(async (req, res) => {
  const { name, password, qrCodeData } = req.body;

  const userExists = await User.findOne({ name });
  if (userExists) {
    res.status(400);
    throw new Error("Already registered.");
  }

  const user = await User.create({
    name,
    password,
    qrCodeData,
  });

  if (user) {
    res.status(201).json({
      _id: user.id,
      name: user.name,
      isAdmin: user.isAdmin,
      token: genToken(user._id),
    });
  } else {
    res.json(400);
    throw new Error("Invalid user data.");
  }
});

const deleteUser = asyncHandler(async (req, res) => {
  try {
    const user = await User.findByIdAndRemove(req.params.id);
    res.json(user);
  } catch (error) {
    res.status(401);
    throw new Error("This user could not be found");
  }
});

const fetchAllUsers = asyncHandler(async (req, res) => {
  try {
    const users = await User.find({});
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
});
const getUserOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.params.id });
  if (orders) {
    res.json(orders);
  } else {
    res.status(404).json({ message: "No Orders found" });
  }
});

userRoutes.route("/").get(protectRoute, admin, fetchAllUsers);
userRoutes.route("/:id").delete(protectRoute, admin, deleteUser);
userRoutes.route("/login").post(loginUser);
userRoutes.route("/register").post(registerUser);
userRoutes.route("/:id").get(protectRoute, getUserOrders);

export default userRoutes;
