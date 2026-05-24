#!/bin/bash
set -e

if ! command -v node &> /dev/null
then
    echo "Node.js not found. Attempting to install Node.js 18..."
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo dnf install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo "Error: Could not install Node.js automatically. Please install it manually."
        exit 1
    fi
    echo "Node.js installed successfully."
fi

echo "Installing dependencies..."
npm install
sudo npm install -g pkg || npm install -g pkg

echo "Building executables for Linux..."
npx pkg sender.js -t node18-linux-x64 -o sender
npx pkg verifier.js -t node18-linux-x64 -o verifier

DESKTOP=$HOME/Desktop
DATADIR=$DESKTOP/verifier-data

echo "Setting up Desktop files..."
mkdir -p "$DATADIR"

mv sender "$DESKTOP/sender"
mv verifier "$DESKTOP/verifier"
chmod +x "$DESKTOP/sender" "$DESKTOP/verifier"

# Copy default configs if they exist
cp config.json "$DATADIR/" 2>/dev/null || true
cp subject.txt "$DATADIR/" 2>/dev/null || true
cp template.txt "$DATADIR/" 2>/dev/null || true

echo "=============================================="
echo "Installation Complete!"
echo "You can now run ./sender and ./verifier from your Desktop."
echo "Your config and data files are located in Desktop/verifier-data."
echo "=============================================="
