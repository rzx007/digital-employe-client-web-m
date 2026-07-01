import { BigInteger } from "jsbn"
import { encodeDer, decodeDer } from "./asn1"
import SM3Digest from "./sm3"
import SM2Cipher from "./sm2"
import * as _ from "./utils"

const { G, curve, n } = _.generateEcparam()
const C1C2C3 = 0

interface SignatureOptions {
  pointPool?: any[]
  der?: boolean
  hash?: boolean
  publicKey?: string
  userId?: string
}

interface VerifyOptions {
  der?: boolean
  hash?: boolean
  userId?: string
}

/**
 * 加密
 */
export function doEncrypt(
  msg: string,
  publicKey: string,
  cipherMode = 1
): string {
  const cipher = new SM2Cipher()
  const msgArray = _.hexToArray(_.parseUtf8StringToHex(msg))

  if (publicKey.length > 128) {
    publicKey = publicKey.substr(publicKey.length - 128)
  }
  const xHex = publicKey.substr(0, 64)
  const yHex = publicKey.substr(64)
  const publicKeyPoint = cipher.createPoint(xHex, yHex)

  const c1 = cipher.initEncipher(publicKeyPoint)

  cipher.encryptBlock(msgArray)
  const c2 = _.arrayToHex(msgArray)

  let c3 = new Array(32)
  cipher.doFinal(c3)
  c3 = _.arrayToHex(c3)

  return cipherMode === C1C2C3 ? c1 + c2 + c3 : c1 + c3 + c2
}

/**
 * 解密
 */
export function doDecrypt(
  encryptData: string,
  privateKey: string,
  cipherMode = 1
): string {
  const cipher = new SM2Cipher()

  privateKey = new BigInteger(privateKey, 16)

  const c1X = encryptData.substr(0, 64)
  const c1Y = encryptData.substr(0 + c1X.length, 64)
  const c1Length = c1X.length + c1Y.length

  let c3 = encryptData.substr(c1Length, 64)
  let c2 = encryptData.substr(c1Length + 64)

  if (cipherMode === C1C2C3) {
    c3 = encryptData.substr(encryptData.length - 64)
    c2 = encryptData.substr(c1Length, encryptData.length - c1Length - 64)
  }

  const data = _.hexToArray(c2)

  const c1 = cipher.createPoint(c1X, c1Y)
  cipher.initDecipher(privateKey, c1)
  cipher.decryptBlock(data)
  const c3_ = new Array(32)
  cipher.doFinal(c3_)

  const isDecrypt = _.arrayToHex(c3_) === c3

  if (isDecrypt) {
    const decryptData = _.arrayToUtf8(data)
    return decryptData
  } else {
    return ""
  }
}

/**
 * 签名
 */
export function doSignature(
  msg: string | ArrayBuffer,
  privateKey: string,
  options: SignatureOptions = {}
): string {
  const { pointPool, der, hash, publicKey, userId } = options
  let hashHex =
    typeof msg === "string"
      ? _.parseUtf8StringToHex(msg)
      : _.parseArrayBufferToHex(msg)

  if (hash) {
    // sm3杂凑
    const pubKey = publicKey || getPublicKeyFromPrivateKey(privateKey)
    hashHex = doSm3Hash(hashHex, pubKey, userId)
  }

  const dA = new BigInteger(privateKey, 16)
  const e = new BigInteger(hashHex, 16)

  // k
  let k = null
  let r = null
  let s = null

  do {
    do {
      let point
      if (pointPool && pointPool.length) {
        point = pointPool.pop()
      } else {
        point = getPoint()
      }
      k = point.k

      // r = (e + x1) mod n
      r = e.add(point.x1).mod(n)
    } while (r.equals(BigInteger.ZERO) || r.add(k).equals(n))

    // s = ((1 + dA)^-1 * (k - r * dA)) mod n
    s = dA
      .add(BigInteger.ONE)
      .modInverse(n)
      .multiply(k.subtract(r.multiply(dA)))
      .mod(n)
  } while (s.equals(BigInteger.ZERO))

  if (der) {
    // asn1 der编码
    return encodeDer(r, s)
  }

  return _.leftPad(r.toString(16), 64) + _.leftPad(s.toString(16), 64)
}

/**
 * 验签
 */
export function doVerifySignature(
  msg: string | ArrayBuffer,
  signHex: string,
  publicKey: string,
  options: VerifyOptions = {}
): boolean {
  const { der, hash, userId } = options
  let hashHex =
    typeof msg === "string"
      ? _.parseUtf8StringToHex(msg)
      : _.parseArrayBufferToHex(msg)

  if (hash) {
    // sm3杂凑
    hashHex = doSm3Hash(hashHex, publicKey, userId)
  }

  let r: BigInteger
  let s: BigInteger
  if (der) {
    const decodeDerObj = decodeDer(signHex)
    r = decodeDerObj.r
    s = decodeDerObj.s
  } else {
    r = new BigInteger(signHex.substring(0, 64), 16)
    s = new BigInteger(signHex.substring(64), 16)
  }

  const PA = curve.decodePointHex(publicKey)
  const e = new BigInteger(hashHex, 16)

  // t = (r + s) mod n
  const t = r.add(s).mod(n)

  if (t.equals(BigInteger.ZERO)) return false

  // x1y1 = s * G + t * PA
  const x1y1 = G.multiply(s).add(PA.multiply(t))

  // R = (e + x1) mod n
  const R = e.add(x1y1.getX().toBigInteger()).mod(n)

  return r.equals(R)
}

/**
 * sm3杂凑算法
 * 计算M值: Hash(za || msg)
 */
export function doSm3Hash(
  hashHex: string,
  publicKey: string,
  userId = "1234567812345678"
): string {
  const smDigest = new SM3Digest()

  const z = new SM3Digest().getZ(G, publicKey.substr(2, 128), userId)
  const zValue = _.hexToArray(_.arrayToHex(z).toString())

  const p = hashHex
  const pValue = _.hexToArray(p)

  const hashData = new Array(smDigest.getDigestSize())
  smDigest.blockUpdate(zValue, 0, zValue.length)
  smDigest.blockUpdate(pValue, 0, pValue.length)
  smDigest.doFinal(hashData, 0)

  return _.arrayToHex(hashData).toString()
}

/**
 * 计算公钥
 */
export function getPublicKeyFromPrivateKey(privateKey: string): string {
  const PA = G.multiply(new BigInteger(privateKey, 16))
  const x = _.leftPad(PA.getX().toBigInteger().toString(16), 64)
  const y = _.leftPad(PA.getY().toBigInteger().toString(16), 64)
  return "04" + x + y
}

/**
 * 获取椭圆曲线点
 */
export function getPoint(): {
  k: BigInteger
  x1: BigInteger
  privateKey: string
  publicKey: string
} {
  const keypair = _.generateKeyPairHex()
  const PA = curve.decodePointHex(keypair.publicKey)

  return {
    k: new BigInteger(keypair.privateKey, 16),
    x1: PA.getX().toBigInteger(),
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
  }
}

// 导出工具函数
export const generateKeyPairHex = _.generateKeyPairHex
