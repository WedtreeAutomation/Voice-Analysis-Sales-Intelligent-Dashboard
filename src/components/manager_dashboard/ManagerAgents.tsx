import { useEffect, useState, useRef } from "react";
import {
    collection,
    getDocs,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp,
    setDoc,
} from "firebase/firestore";
import { Plus, Edit2, Trash2, X, Loader2, User as User_Icon, Check, AlertCircle, Users, Crown, Star, Store, Globe } from "lucide-react"; 
import { db } from "../../firebase";
import { toast } from "react-toastify";

import { User } from "../../types";

interface ManagerAgentsProps {
    user: User;
    isDarkMode: boolean; 
}

interface Agent {
    id?: string;
    name: string;
    email: string;
    phone: string;
    profilePic: string;
    role: "agent" | "manager";
    agentType: "store" | "online"; 
    stats?: {
        totalCalls: number;
        overallScore: number;
    };
    createdAt?: any;
    updatedAt?: any;
}

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

export default function ManagerAgents({ user, isDarkMode }: ManagerAgentsProps) {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<Agent | null>(null);
    const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
    const [form, setForm] = useState<Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'stats'>>({
        name: "",
        email: "",
        phone: "",
        profilePic: "",
        role: "agent",
        agentType: "online", 
    });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const agentsCol = collection(db, "agents");

    const fetchAgents = async () => {
        setLoading(true);
        try {
            const snapshot = await getDocs(agentsCol);
            const data = snapshot.docs.map((docSnap) => ({
                id: docSnap.id,
                agentType: docSnap.data().agentType || "online", 
                ...docSnap.data(),
            })) as Agent[];
            setAgents(data);
        } catch (error) {
            console.error("Error fetching agents:", error);
            toast.error("Failed to load agents");
        } finally {
            setLoading(false);
        }
    };

    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};

        if (!form.name.trim()) errors.name = "Name is required";
        if (!form.email.trim()) {
            errors.email = "Email is required";
        } else if (!/^\S+@\S+\.\S+$/.test(form.email)) {
            errors.email = "Invalid email format";
        }
        if (!form.phone.trim()) errors.phone = "Phone is required";

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const saveAgent = async () => {
        if (!validateForm()) return;

        setSaving(true);
        try {
            const agentData = {
                ...form,
                updatedAt: serverTimestamp(),
                ...(!editingAgent && { 
                    createdAt: serverTimestamp(),
                    stats: {
                        totalCalls: 0,
                        overallScore: 0
                    }
                })
            };

            const docRef = editingAgent?.id
                ? doc(db, "agents", editingAgent.id)
                : doc(db, "agents", form.email); 

            await (editingAgent
                ? updateDoc(docRef, agentData)
                : setDoc(docRef, agentData));

            toast.success(`Agent ${editingAgent ? "updated" : "added"} successfully`);
            setModalOpen(false);
            fetchAgents();
        } catch (error) {
            console.error("Error saving agent:", error);
            toast.error(`Failed to ${editingAgent ? "update" : "add"} agent`);
        } finally {
            setSaving(false);
        }
    };

    const removeAgent = async (id: string) => {
        setDeleting(true);
        try {
            await deleteDoc(doc(db, "agents", id));
            toast.success("Agent deleted successfully");
            fetchAgents();
        } catch (error) {
            console.error("Error deleting agent:", error);
            toast.error("Failed to delete agent");
        } finally {
            setDeleting(false);
            setDeleteConfirm(null);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_IMAGE_SIZE) {
            toast.error("Image size must be less than 2MB");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setForm({ ...form, profilePic: reader.result as string });
        };
        reader.onerror = () => {
            toast.error("Error reading image file");
        };
        reader.readAsDataURL(file);
    };

    const openAddModal = () => {
        setEditingAgent(null);
        setForm({
            name: "",
            email: "",
            phone: "",
            profilePic: "",
            role: "agent",
            agentType: "online", 
        });
        setFormErrors({});
        setModalOpen(true);
    };

    const openEditModal = (agent: Agent) => {
        setEditingAgent(agent);
        setForm({
            name: agent.name,
            email: agent.email,
            phone: agent.phone,
            profilePic: agent.profilePic,
            role: agent.role,
            agentType: agent.agentType || "online", 
        });
        setFormErrors({});
        setModalOpen(true);
    };

    const getAvatarColor = (name: string) => {
        const colors = [
            'from-pink-500 to-rose-500',
            'from-purple-500 to-indigo-500',
            'from-blue-500 to-cyan-500',
            'from-green-500 to-teal-500',
            'from-yellow-500 to-orange-500',
            'from-red-500 to-pink-500'
        ];
        const index = name.charCodeAt(0) % colors.length;
        return colors[index];
    };

    const getInitials = (name: string) => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase();
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    return (
        <div className={`min-h-screen p-4 ${isDarkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-indigo-50 via-white to-cyan-50'}`}>
            <div className="max-w-6xl mx-auto">
                {/* Header Section */}
                <div className={`rounded-2xl shadow-xl p-8 mb-8 border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-indigo-100'}`}>
                    <div className="flex flex-col md:flex-row justify-between items-center">
                        <div className="flex items-center space-x-4 mb-6 md:mb-0">
                            <div className="h-16 w-16 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                                <Users className="h-8 w-8 text-white" />
                            </div>
                            <div>
                                <h1 className={`text-4xl font-bold bg-clip-text text-transparent ${isDarkMode ? 'bg-gradient-to-r from-indigo-400 to-purple-400' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`}>
                                    Team Management
                                </h1>
                                <p className={`mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Manage your agents and team members</p>
                            </div>
                        </div>
                        <button
                            onClick={openAddModal}
                            className="flex items-center px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                            disabled={loading}
                        >
                            <Plus className="h-5 w-5 mr-2" />
                            Add New Agent
                        </button>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl p-6 text-white shadow-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-100">Total Agents</p>
                                <p className="text-3xl font-bold">{agents.length}</p>
                            </div>
                            <Users className="h-12 w-12 text-blue-200" />
                        </div>
                    </div>
                    <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-6 text-white shadow-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-100">Managers</p>
                                <p className="text-3xl font-bold">{agents.filter(a => a.role === 'manager').length}</p>
                            </div>
                            <Crown className="h-12 w-12 text-purple-200" />
                        </div>
                    </div>
                    <div className="bg-gradient-to-r from-green-500 to-teal-500 rounded-2xl p-6 text-white shadow-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-100">Active Agents</p>
                                <p className="text-3xl font-bold">{agents.filter(a => a.role === 'agent').length}</p>
                            </div>
                            <Star className="h-12 w-12 text-green-200" />
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className={`rounded-2xl shadow-xl overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <div className="text-center">
                                <Loader2 className="h-12 w-12 text-indigo-600 animate-spin mx-auto mb-4" />
                                <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading agents...</p>
                            </div>
                        </div>
                    ) : agents.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="h-24 w-24 bg-gradient-to-r from-gray-300 to-gray-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users className="h-12 w-12 text-white" />
                            </div>
                            <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>No agents found</h3>
                            <p className={`mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Add your first agent to get started with team management</p>
                            <button
                                onClick={openAddModal}
                                className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl hover:shadow-lg transition-all duration-300"
                            >
                                <Plus className="h-4 w-4 inline mr-2" />
                                Add First Agent
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className={`${isDarkMode ? 'bg-gray-700' : 'bg-gradient-to-r from-gray-50 to-gray-100'}`}>
                                    <tr>
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Profile</th>
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Name</th>
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Email</th>
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Role</th>
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Type</th> 
                                        <th className={`text-left py-6 px-6 font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody className={`divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-white divide-gray-100'}`}>
                                    {agents.map((agent) => (
                                        <tr key={agent.id} className={`transition-all duration-300 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gradient-to-r hover:from-indigo-50 hover:to-purple-50'}`}>
                                            <td className="py-6 px-6">
                                                <div className="flex items-center space-x-3">
                                                    <div className="h-12 w-12 rounded-xl overflow-hidden shadow-lg">
                                                        {agent.profilePic ? (
                                                            <img
                                                                src={agent.profilePic}
                                                                alt={agent.name}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className={`h-full w-full bg-gradient-to-br ${getAvatarColor(agent.name)} flex items-center justify-center text-white font-semibold`}>
                                                                {getInitials(agent.name)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-6 px-6">
                                                <div className={`font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{agent.name}</div>
                                            </td>
                                            <td className="py-6 px-6">
                                                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{agent.email}</div>
                                            </td>
                                            <td className="py-6 px-6">
                                                {/* Role Badge */}
                                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                                    agent.role === 'manager'
                                                        ? (isDarkMode ? 'bg-purple-900/40 text-purple-300' : 'bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 border border-purple-200')
                                                        : (isDarkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 border border-blue-200')
                                                }`}>
                                                    {agent.role === 'manager' && <Crown className="h-3 w-3 mr-1" />}
                                                    {agent.role === 'agent' && <User_Icon className="h-3 w-3 mr-1" />}
                                                    {agent.role.charAt(0).toUpperCase() + agent.role.slice(1)}
                                                </span>
                                            </td>
                                            <td className="py-6 px-6">
                                                {/* Agent Type Badge */}
                                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                                    agent.agentType === 'store'
                                                        ? (isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 border border-amber-200')
                                                        : (isDarkMode ? 'bg-teal-900/40 text-teal-300' : 'bg-gradient-to-r from-teal-100 to-green-100 text-teal-800 border border-teal-200')
                                                }`}>
                                                    {agent.agentType === 'store' ? <Store className="h-3 w-3 mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
                                                    {agent.agentType === 'store' ? 'Store Agent' : 'Online Agent'}
                                                </span>
                                            </td>
                                            <td className="py-6 px-6">
                                                <div className="flex space-x-3">
                                                    <button
                                                        onClick={() => openEditModal(agent)}
                                                        className={`p-2 text-indigo-600 rounded-lg transition-colors duration-200 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-indigo-100'}`}
                                                        title="Edit"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteConfirm(agent)}
                                                        className={`p-2 text-red-600 rounded-lg transition-colors duration-200 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-red-100'}`}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Add/Edit Modal (Updated for scrollability and smaller max-height) */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    {/* The modal container is adjusted to have max-h-full and overflow-y-auto */}
                    <div className={`rounded-2xl p-8 w-full max-w-md relative shadow-2xl border max-h-[90vh] overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                        <button
                            onClick={() => setModalOpen(false)}
                            className={`absolute top-4 right-4 p-2 rounded-lg transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                            disabled={saving}
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="mb-6">
                            <h3 className={`text-2xl font-bold bg-clip-text text-transparent mb-2 ${isDarkMode ? 'bg-gradient-to-r from-indigo-400 to-purple-400' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`}>
                                {editingAgent ? "Edit Agent" : "Add New Agent"}
                            </h3>
                            <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Fill in the details below</p>
                        </div>

                        <div className="space-y-6">
                            <div className="flex flex-col items-center space-y-4">
                                <div className={`h-20 w-20 rounded-2xl overflow-hidden shadow-lg border-4 ${isDarkMode ? 'border-gray-800' : 'border-white'}`}>
                                    {form.profilePic ? (
                                        <img
                                            src={form.profilePic}
                                            alt="Profile"
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className={`h-full w-full bg-gradient-to-br ${getAvatarColor(form.name || 'User')} flex items-center justify-center text-white font-semibold text-lg`}>
                                            {form.name ? getInitials(form.name) : <User_Icon className="h-8 w-8" />}
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleImageUpload}
                                    accept="image/*"
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 text-gray-700'}`}
                                    disabled={saving}
                                >
                                    {form.profilePic ? "Change Photo" : "Upload Photo"}
                                </button>
                            </div>

                            <div>
                                <label className={`block text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Full Name*
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 ${
                                        formErrors.name ? "border-red-300 bg-red-50 dark:bg-red-900/20" : `${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100 hover:border-gray-500' : 'border-gray-200 hover:border-gray-300'}`
                                    }`}
                                    placeholder="Enter full name"
                                />
                                {formErrors.name && (
                                    <p className="text-red-500 text-sm mt-2 flex items-center">
                                        <AlertCircle className="h-4 w-4 mr-1" /> {formErrors.name}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className={`block text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Email Address*
                                </label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 ${
                                        formErrors.email ? "border-red-300 bg-red-50 dark:bg-red-900/20" : `${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100 hover:border-gray-500' : 'border-gray-200 hover:border-gray-300'}`
                                    }`}
                                    placeholder="Enter email address"
                                />
                                {formErrors.email && (
                                    <p className="text-red-500 text-sm mt-2 flex items-center">
                                        <AlertCircle className="h-4 w-4 mr-1" /> {formErrors.email}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className={`block text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Phone Number*
                                </label>
                                <input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className={`w-full border-2 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300 ${
                                        formErrors.phone ? "border-red-300 bg-red-50 dark:bg-red-900/20" : `${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100 hover:border-gray-500' : 'border-gray-200 hover:border-gray-300'}`
                                    }`}
                                    placeholder="Enter phone number"
                                />
                                {formErrors.phone && (
                                    <p className="text-red-500 text-sm mt-2 flex items-center">
                                        <AlertCircle className="h-4 w-4 mr-1" /> {formErrors.phone}
                                    </p>
                                )}
                            </div>
                            
                            {/* Agent Type Selection */}
                            <div>
                                <label className={`block text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Agent Type*
                                </label>
                                <div className={`p-4 rounded-xl flex space-x-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gradient-to-r from-blue-50 to-cyan-50'}`}>
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="agentType"
                                            checked={form.agentType === "online"}
                                            onChange={() => setForm({ ...form, agentType: "online" })}
                                            className="h-5 w-5 rounded-full border-gray-300 text-teal-600 focus:ring-teal-500"
                                        />
                                        <Globe className={`h-5 w-5 ${isDarkMode ? 'text-teal-400' : 'text-teal-600'}`} />
                                        <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Online</span>
                                    </label>
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="agentType"
                                            checked={form.agentType === "store"}
                                            onChange={() => setForm({ ...form, agentType: "store" })}
                                            className="h-5 w-5 rounded-full border-gray-300 text-amber-600 focus:ring-amber-500"
                                        />
                                        <Store className={`h-5 w-5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                                        <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Store</span>
                                    </label>
                                </div>
                            </div>

                            <div className={`rounded-xl p-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gradient-to-r from-indigo-50 to-purple-50'}`}>
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.role === "manager"}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                role: e.target.checked ? "manager" : "agent",
                                            })
                                        }
                                        className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <div className="flex items-center space-x-2">
                                        <Crown className={`h-5 w-5 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                        <span className={`font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Manager Role</span>
                                    </div>
                                </label>
                                <p className={`mt-1 ml-8 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Grant management permissions</p>
                            </div>

                            <button
                                onClick={saveAgent}
                                disabled={saving}
                                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-3 rounded-xl hover:from-indigo-600 hover:to-purple-700 font-semibold transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none flex items-center justify-center"
                            >
                                {saving ? (
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                ) : (
                                    <Check className="h-5 w-5 mr-2" />
                                )}
                                {editingAgent ? "Update Agent" : "Create Agent"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className={`rounded-2xl p-8 w-full max-w-sm shadow-2xl border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
                        <div className="text-center">
                            <div className="h-16 w-16 bg-gradient-to-r from-red-100 to-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Trash2 className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Delete Agent</h3>
                            <p className={`mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                Are you sure you want to delete <span className="font-semibold">{deleteConfirm.name}</span>? This action cannot be undone.
                            </p>
                            <div className="flex space-x-3">
                                <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className={`flex-1 px-4 py-3 border-2 rounded-xl hover:bg-gray-50 font-medium transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-700'}`}
                                    disabled={deleting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => deleteConfirm.id && removeAgent(deleteConfirm.id)}
                                    disabled={deleting}
                                    className="flex-1 px-4 py-3 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-xl hover:from-red-600 hover:to-pink-700 font-medium transition-all duration-300 shadow-lg flex items-center justify-center"
                                >
                                    {deleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <Trash2 className="h-4 w-4 mr-2" />
                                    )}
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}