VER=$(date +%Y%m%d%H%M)
# VER=latest
sed -i '' "s/v=[0-9]\{8,12\}/v=$VER/g" index.html fiona/index.html
git add .
git commit -m "Update $VER"
git push