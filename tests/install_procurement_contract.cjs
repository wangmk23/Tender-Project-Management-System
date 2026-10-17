const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
module.exports=context=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'),context);
