import {
  generateKeyPairHex,
  doEncrypt,
  doDecrypt,
  doSignature,
  doVerifySignature,
} from "./"

// 生成密钥对
const keypair = generateKeyPairHex()
console.log("私钥:", keypair.privateKey)
console.log("公钥:", keypair.publicKey)

// 加密
const msg = "这是一段需要加密的文本"
const encryptData = doEncrypt(msg, keypair.publicKey)
console.log("加密结果:", encryptData)

// 解密
const decryptData = doDecrypt(encryptData, keypair.privateKey)
console.log("解密结果:", decryptData)

// 签名
const signature = doSignature(msg, keypair.privateKey, { hash: true })
console.log("签名结果:", signature)

// 验签
const verifyResult = doVerifySignature(msg, signature, keypair.publicKey, {
  hash: true,
})
console.log("验签结果:", verifyResult)
