const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const app = express();

const corsOptions = {
	origin: [
		"http://localhost:5173",
		"http://localhost:5174",
		"https://diagnoease-1e7b9.web.app",
	],
	credentials: true,
	optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// verify jwt middleware
const verifyToken = (req, res, next) => {
	// const token = req.cookies?.token;
	if (!req.headers.authorization) {
		return res.status(401).send({ message: "unauthorized access" });
	}
	const token = req.headers.authorization.split(" ")[1];

	if (!token) return res.status(401).send({ message: "unauthorized access" });

	if (token) {
		jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
			if (err) {
				console.log(err);
				return res.status(401).send({ message: "unauthorized access" });
			}
			req.user = decoded;
			next();
		});
	}
};

// MongoDB Database
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ahe248t.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

const cookieOptions = {
	httpOnly: true,
	secure: process.env.NODE_ENV === "production",
	sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		// Await client.connect();

		const db = client.db("DiagnoEaseDB");
		const districtsCollection = db.collection("districts");
		const upazilasCollection = db.collection("upazilas");
		const usersCollection = db.collection("users");
		const testsCollection = db.collection("tests");
		const appointmentsCollection = db.collection("appointments");
		const bannersCollection = db.collection("banners");
		const recommendationsCollection = db.collection("recommendations");

		//Creating JWT Token
		app.post("/jwt", async (req, res) => {
			const user = req.body;
			// console.log("user for token", user);
			const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
				expiresIn: "365d",
			});

			// res.cookie("token", token, cookieOptions).send({ success: true });
			res.send({ token });
		});

		//Clearing JWT Token
		app.post("/logout", async (req, res) => {
			const user = req.body;
			// console.log("logging out", user);
			res
				.clearCookie("token", { ...cookieOptions, maxAge: 0 })
				.send({ success: true });
		});

		const verifyAdmin = async (req, res, next) => {
			const email = req.user.email;
			const query = { email: email };
			const result = await usersCollection.findOne(query);
			if (!result || result?.role !== "admin") {
				return res.status(403).send({ message: "forbidden access" });
			}
			next();
		};

		// API Services

		app.get("/districts", async (req, res) => {
			const result = await districtsCollection.find().toArray();
			res.send(result);
		});
		app.get("/upazilas", async (req, res) => {
			const result = await upazilasCollection.find().toArray();
			res.send(result);
		});

		// Create-Payment-intent
		app.post(
			"/create-payment-intent",
			verifyToken,
			async (req, res) => {
				const price = req.body.price;
				const priceInCent = parseFloat(price) * 100;
				if (!price || priceInCent < 1) return;
				// Generate ClientSecret
				const { client_secret } = await stripe.paymentIntents.create({
					amount: priceInCent,
					currency: "usd",
					// In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
					automatic_payment_methods: {
						enabled: true,
					},
				});
				// send client secret as response
				res.send({ clientSecret: client_secret });
			}
		);

		// User Collection
		app.post("/user", async (req, res) => {
			const userdata = req.body;
			const result = await usersCollection.insertOne(userdata);
			res.send(result);
		});

		app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
			const result = await usersCollection.find().toArray();
			res.send(result);
		});

		app.get("/user/:email", verifyToken, async (req, res) => {
			const userEmail = req.params.email;
			const query = { email: userEmail };
			const result = await usersCollection.findOne(query);
			res.send(result);
		});

		app.patch("/user/:id", verifyToken, async (req, res) => {
			const userData = req.body;
			const id = req.params.id;
			const updateDoc = {
				$set: {
					...userData,
				},
			};
			const query = { _id: new ObjectId(id) };
			const result = await usersCollection.updateOne(query, updateDoc);
			res.send(result);
		});

		// Test Collection
		app.post("/test", verifyToken, verifyAdmin, async (req, res) => {
			const testData = req.body;
			const result = await testsCollection.insertOne(testData);
			res.send(result);
		});

		// Admin dashboard test
		app.get("/tests", verifyToken, verifyAdmin, async (req, res) => {
			const currentDate = new Date();
			const result = await testsCollection.find().toArray();
			res.send(result);
		});
		// Common User Test
		app.get("/available-tests", async (req, res) => {
			const { filterDate, page, size } = req.query;
			const itemsPerPage = parseInt(size);
			const skipItems = (parseInt(page) - 1) * itemsPerPage;
			const currentDate = new Date().toISOString();
			let query = { date: { $gte: currentDate } };

			if (filterDate) {
				const startOfDay = new Date(filterDate);
				startOfDay.setUTCHours(0, 0, 0, 0);

				const endOfDay = new Date(filterDate);
				endOfDay.setUTCHours(23, 59, 59, 999);

				query = {
					date: {
						$gte: startOfDay.toISOString(),
						$lte: endOfDay.toISOString(),
					},
				};
				// Logging for Debugging
				console.log("Start of Day:", startOfDay.toISOString());
				console.log("End of Day:", endOfDay.toISOString());
				console.log("Query:", JSON.stringify(query));
			}
			try {
				const result = await testsCollection
					.find(query)
					.skip(skipItems)
					.limit(itemsPerPage)
					.toArray();

				const totalTests = await testsCollection.countDocuments(query);
				const totalPages = Math.ceil(totalTests / itemsPerPage);

				res.send({ data: result, totalTests });
			} catch (error) {
				res.status(500).send({ message: "An error occurred", error });
			}
		});

		app.get("/test/:id", verifyToken, async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await testsCollection.findOne(query);
			res.send(result);
		});

		app.patch("/test/:id", verifyToken, verifyAdmin, async (req, res) => {
			const id = req.params.id;
			const testData = req.body;
			const updateDoc = {
				$set: {
					...testData,
				},
			};
			const query = { _id: new ObjectId(id) };
			const result = await testsCollection.updateOne(query, updateDoc);
			res.send(result);
		});

		app.delete("/test/:id", verifyToken, verifyAdmin, async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await testsCollection.deleteOne(query);
			res.send(result);
		});

		// Appointments Collection
		app.post("/booking", verifyToken, async (req, res) => {
			// Upload new Booking Data
			const newData = req.body;
			const result = await appointmentsCollection.insertOne(newData);
			// Update Test Collection
			const updateDoc = {
				$inc: { slots: -1 },
			};
			const query = { _id: new ObjectId(newData.testData._id) };
			const updateTestSlotsNumber = await testsCollection.updateOne(
				query,
				updateDoc
			);
			if (updateTestSlotsNumber.modifiedCount && result.acknowledged === true) {
				res
					.status(200)
					.send({ success: true, message: "Appointment Booked Successfully" });
			}
		});

		app.delete("/booking/:id", verifyToken, async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await appointmentsCollection.deleteOne(query);
			// console.log(id, result);
			res.send(result);
		});

		app.get(
			"/appointments/:testId",
			verifyToken,
			verifyAdmin,
			async (req, res) => {
				const testId = req.params.testId;
				const { email } = req.query;
				let query = { "testData._id": testId };
				if (email) {
					query["user.email"] = email;
				}
				// console.log(query);
				const result = await appointmentsCollection.find(query).toArray();
				res.send(result);
			}
		);

		app.get("/upcomming-appointments/:email", verifyToken, async (req, res) => {
			const email = req.params.email;
			const query = { "user.email": email, status: "pending" };
			const result = await appointmentsCollection.find(query).toArray();
			res.send(result);
		});

		app.get("/test-results/:email", verifyToken, async (req, res) => {
			const email = req.params.email;
			const query = { "user.email": email, status: "delivered" };
			const result = await appointmentsCollection.find(query).toArray();
			res.send(result);
		});

		app.get(
			"/user-appointments/:email",
			verifyToken,
			verifyAdmin,
			async (req, res) => {
				const email = req.params.email;
				const query = { "user.email": email };
				const result = await appointmentsCollection.find(query).toArray();
				res.send(result);
			}
		);

		app.get("/featured-tests/", async (req, res) => {
			const pipeline = [
				{
					$group: {
						_id: "$testData._id",
						name: { $first: "$testData.name" },
						image: { $first: "$testData.image" },
						description: { $first: "$testData.description" },
						price: { $first: "$testData.price" },
						date: { $first: "$testData.date" },
						slots: { $first: "$testData.slots" },
						count: { $sum: 1 },
					},
				},
				{
					$sort: { count: -1 },
				},
				{
					$limit: 5, // Limit to top 5 most booked tests
				},
				{
					$project: {
						_id: 1,
						// testId: "$_id",
						name: 1,
						image: 1,
						description: 1,
						price: 1,
						date: 1,
						slots: 1,
						count: 1,
					},
				},
			];
			const featuredTest = await appointmentsCollection
				.aggregate(pipeline)
				.toArray();
			res.send(featuredTest);
		});

		app.patch(
			"/report-submit/:email/:id",
			verifyToken,
			verifyAdmin,
			async (req, res) => {
				const id = req.params.id;
				const email = req.params.email;
				const reportData = req.body;
				const updateDoc = {
					$set: {
						result: reportData.result,
						resultDeliveryDate: reportData.resultDeliveryDate,
						status: "delivered",
					},
				};
				const query = { _id: new ObjectId(id), "user.email": email };
				const result = await appointmentsCollection.updateOne(query, updateDoc);
				res.send(result);
			}
		);

		// Banner collection
		app.post("/banner", verifyToken, verifyAdmin, async (req, res) => {
			const bannerData = req.body;
			const result = await bannersCollection.insertOne(bannerData);
			res.send(result);
		});

		app.get("/banner", async (req, res) => {
			const result = await bannersCollection.find().toArray();
			res.send(result);
		});

		app.delete("/banner/:id", verifyToken, verifyAdmin, async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await bannersCollection.deleteOne(query);
			res.send(result);
		});

		app.put(
			"/banner/:id/activate",
			verifyToken,
			verifyAdmin,
			async (req, res) => {
				const id = req.params.id;
				// update all banner as inactive
				const updateAllBanner = await bannersCollection.updateMany(
					{},
					{
						$set: {
							isActive: false,
						},
					}
				);
				// console.log(updateAllBanner);
				// update seleted banner as active
				const query = { _id: new ObjectId(id) };
				const updateDoc = {
					$set: {
						isActive: true,
					},
				};
				const result = await bannersCollection.updateOne(query, updateDoc);
				res.send(result);
			}
		);

		app.get("/active-banner", async (req, res) => {
			const query = { isActive: true };
			const result = await bannersCollection.findOne(query);
			res.send(result);
		});

		// Admin stat Data
		app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
			const bookedTestPipeline = [
				{
					$group: {
						_id: "$testData._id",
						name: { $first: "$testData.name" },
						count: { $sum: 1 },
					},
				},
				{
					$sort: { count: -1 },
				},
				{
					$limit: 10,
				},
				{
					$project: {
						_id: 0,
						name: 1,
						count: 1,
					},
				},
			];
			const bookedTestData = await appointmentsCollection
				.aggregate(bookedTestPipeline)
				.toArray();
			const mostlyBookedChartData = bookedTestData.map((data) => {
				const result = [data.name, data.count];
				return result;
			});
			mostlyBookedChartData.unshift(["Test Name", "Total Booked"]);
			// Delivery Status Chart Data
			const deliveryStatusPipeline = [
				{
					$group: {
						_id: "$status",
						count: { $sum: 1 },
					},
				},
				{
					$project: {
						_id: 0,
						status: "$_id",
						count: 1,
					},
				},
			];
			const deliveryStatusData = await appointmentsCollection
				.aggregate(deliveryStatusPipeline)
				.toArray();
			const deliveryData = deliveryStatusData.map((data) => {
				const result = [data.status, data.count];
				return result;
			});
			deliveryData.unshift(["Delivery Status", "count"]);
			res.send({
				mostlyBookedChartData: mostlyBookedChartData,
				deliverySatusChartData: deliveryData,
			});
		});

		// recommendation collection
		app.get("/recommendations", async (req, res) => {
			const result = await recommendationsCollection.find().toArray();
			res.send(result);
		});

		// Send a ping to confirm a successful connection
		await client.db("admin").command({ ping: 1 });
		console.log(
			"Pinged your deployment. You successfully connected to MongoDB!"
		);
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("Your Server is Running");
});

app.listen(port, () => {
	console.log(`Server is running on: http://localhost:${port}/`);
});
