import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyD9hHDcTFh0a-3eSsXJ-sdD4_U78bsagYA",
    authDomain: "prince-hacks-test.firebaseapp.com",
    databaseURL: "https://prince-hacks-test-default-rtdb.firebaseio.com",
    projectId: "prince-hacks-test",
    storageBucket: "prince-hacks-test.firebasestorage.app",
    messagingSenderId: "1070897490445",
    appId: "1:1070897490445:web:17b1cb1461fd76bb888344",
    measurementId: "G-8HF61FHCWN"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
