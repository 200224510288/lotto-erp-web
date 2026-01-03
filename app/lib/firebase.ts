// app/lib/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDDHk4M47pNv_Mc87dfVdINFU1bqlpvS0E",
  authDomain: "automation-b601c.firebaseapp.com",
  projectId: "automation-b601c",
  storageBucket: "automation-b601c.firebasestorage.app",
  messagingSenderId: "945405914572",
  appId: "1:945405914572:web:7113bd4e442cb414d60169",
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
