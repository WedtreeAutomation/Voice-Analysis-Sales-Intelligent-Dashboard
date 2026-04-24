import React, { useState } from "react";
import { User, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

interface LoginPageProps {
  onLogin: (user: {
    email: string;
    role: "agent" | "manager";
    name: string;
    profilePic?: string;
  }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "manager">("agent");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const agentsRef = collection(db, "agents");
      const q = query(
        agentsRef,
        where("email", "==", email.trim()),
        where("phone", "==", password.trim()),
        where("role", "==", role)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const agentData = snapshot.docs[0].data() as {
          name: string;
          email: string;
          role: "agent" | "manager";
          profilePic?: string;
        };

        // Always use Firestore name & profilePic
        onLogin({
          email: agentData.email,
          role: agentData.role,
          name: agentData.name,
          profilePic: agentData.profilePic
        });

        if (agentData.role === "agent") {
          navigate("/agent-dashboard");
        } else {
          navigate("/manager-dashboard");
        }
      } else {
        setError("Invalid email, phone, or role");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row bg-cover bg-center relative overflow-hidden"
      style={{ backgroundImage: "url('/background.png')" }}
    >
      {/* Left Section */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-purple-900/30 to-pink-900/40"></div>
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex flex-col justify-center px-8 lg:px-12 py-12 lg:py-0 text-left">
        <h1 className="text-5xl lg:text-7xl font-black text-white mb-4 lg:mb-6 drop-shadow-2xl tracking-wider">
          Prashanti Sarees
        </h1>
        <p className="text-xl lg:text-3xl text-white/90 drop-shadow-lg font-light tracking-wide mb-6">
            TRADITION FOR GENERATIONS
        </p>
        <div className="w-24 lg:w-32 h-1 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full mb-6"></div>
        <p className="text-lg lg:text-xl text-white/80 drop-shadow font-light leading-relaxed">
          Experience excellence through heritage.<br />
          Where tradition meets innovation.
        </p>
      </div>

      {/* Right Section - Form */}
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex items-center justify-center px-6 sm:px-8 py-8 lg:py-0">
        <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl p-6 sm:p-8 border border-white/20 w-full max-w-md">
          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">
              Sales Intelligence Dashboard
            </h2>
            <p className="text-gray-600 text-sm sm:text-base">
              Sign in to your account
            </p>
            <div className="w-12 h-1 bg-gradient-to-r from-purple-600 to-pink-600 mx-auto rounded-full mt-3"></div>
          </div>

          {/* Role Selection */}
          <div className="mb-6">
            <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-3 text-center">
              Select your role
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole("agent")}
                className={`group flex items-center justify-center py-3 px-4 rounded-xl border-2 text-xs sm:text-sm font-semibold transition-all duration-300 ${
                  role === "agent"
                    ? "border-purple-500 bg-gradient-to-r from-purple-50 to-purple-100 text-purple-700 shadow-md ring-1 ring-purple-200"
                    : "border-gray-300 bg-gray-50 text-gray-700 hover:border-purple-400 hover:bg-gradient-to-r hover:from-purple-50 hover:to-purple-100 hover:text-purple-600"
                }`}
              >
                <User className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Agent
              </button>
              <button
                type="button"
                onClick={() => setRole("manager")}
                className={`group flex items-center justify-center py-3 px-4 rounded-xl border-2 text-xs sm:text-sm font-semibold transition-all duration-300 ${
                  role === "manager"
                    ? "border-purple-500 bg-gradient-to-r from-purple-50 to-purple-100 text-purple-700 shadow-md ring-1 ring-purple-200"
                    : "border-gray-300 bg-gray-50 text-gray-700 hover:border-purple-400 hover:bg-gradient-to-r hover:from-purple-50 hover:to-purple-100 hover:text-purple-600"
                }`}
              >
                <Shield className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Manager
              </button>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 sm:px-5 sm:py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-500 text-sm sm:text-base"
                placeholder="Enter your work email"
                required
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 sm:px-5 sm:py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-500 text-sm sm:text-base"
                placeholder="Enter your phone number"
                required
              />
            </div>

            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 px-4 rounded-xl font-bold text-sm sm:text-base hover:from-purple-700 hover:to-pink-700 focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-md relative overflow-hidden group"
            >
              <span className="relative z-10">
                {loading ? "Signing in..." : "Sign In"}
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 transform -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500 font-medium">
              © 2025 Prashanti Sarees. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}