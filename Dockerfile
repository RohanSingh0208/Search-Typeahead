# Use Node.js 22 Alpine image (lightweight)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Generate the initial dataset and seed the SQLite database
# This ensures the database exists inside the image
RUN npm run setup

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
