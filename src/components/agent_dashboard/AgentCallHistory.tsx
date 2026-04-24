import { Phone, Filter, ChevronDown, User as User_Icon, ArrowRight, Play, Pause, SortAsc, SortDesc, BarChart3, Clock, TrendingUp, Globe, MessageCircle, Target, Heart, Shield, Star, Award, Volume2, Tags, Mic } from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { collection, query, getDocs, orderBy, Timestamp, where, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { User } from '../../types';

interface AgentCallHistoryProps {
    user: User;
    isDarkMode: boolean;
}

// === NEW/UPDATED INTERFACES ===
interface CallType {
    primary: string;
    subCategory: string;
    confidence: number;
    secondary: string[];
}

interface ToneAnalysis {
    agentMood: string;
    customerMood: string;
    toneMark: number;
    reasoning: string;
}

interface CallRecord {
    id: string;
    callId: string;
    agentId: string;
    agentName: string;
    agentEmail: string;
    caller: string;
    called: string;
    dialed: string;
    timestamp: Timestamp;
    duration: number;
    recordingUrl: string;
    summary: string;
    objections: string[];
    competitors: string[];
    scores: {
        structure: number;
        clarity: number;
        confidence: number;
        closing: number;
        intro: number;
        call_summary: number;
        end_call: number;
        upselling: number;
        sympathy: number;
    };
    overallScore: number;
    coachingTips: string[];
    language: string;
    fillerWords: number;
    talkRatio: string;
    keyTopics: string[];
    sentiment: string;
    holdTime: number;
    callAnalysis: {
        company_intro_early: boolean;
        provided_summary: boolean;
        asked_for_more_queries: boolean;
        upselling_attempted: boolean;
        polite_language_used: boolean;
    };
    callSections: {
        intro: { summary: string; present: boolean };
        discovery: { summary: string; present: boolean };
        demo: { summary: string; present: boolean };
        objection: { summary: string; present: boolean };
        closure: { summary: string; present: boolean };
    };
    metadata: {
        circle: string;
        network: string;
        ringtime: string;
        starttime: string;
        endtime: string;
        processedAt: Timestamp;
        audioExpiresAt: string;
    };
    callType: CallType;
    toneAnalysis: ToneAnalysis; // ADDED TONE FIELD
}

interface AgentStats {
    totalCalls: number;
    overallScore: number;
    lastCallDate: Timestamp;
    avgDuration: number;
}
// === END INTERFACES ===

type DateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type ViewMode = 'list' | 'analytics';
type SortField = 'date' | 'score' | 'duration';
type SortDirection = 'asc' | 'desc';

const dateFilterOptions = [
    { value: 'all', label: 'All Time', color: 'bg-slate-500' },
    { value: 'today', label: 'Today', color: 'bg-blue-500' },
    { value: 'yesterday', label: 'Yesterday', color: 'bg-indigo-500' },
    { value: 'week', label: 'Past Week', color: 'bg-purple-500' },
    { value: 'month', label: 'Past Month', color: 'bg-fuchsia-500' },
    { value: 'custom', label: 'Custom Range', color: 'bg-pink-500' },
];

const LANGUAGE_COLORS = {
    English: '#3B82F6',
    Hindi: '#EF4444',
    Tamil: '#10B981',
    Telugu: '#F59E0B',
    Kannada: '#8B5CF6',
    Malayalam: '#EC4899',
    Other: '#6B7280'
};

const ITEMS_PER_PAGE = 10;

// Enhanced StatCard Component (Modified for smaller size)
const StatCard = ({
    title,
    value,
    icon,
    bgColor,
    sentiment,
    isDarkMode
}: {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    bgColor: string;
    trend?: 'up' | 'down' | 'neutral';
    sentiment?: string;
    isDarkMode: boolean;
}) => {
    const getSentimentColor = (sentiment: string) => {
        switch (sentiment?.toLowerCase()) {
            case 'positive': return 'text-emerald-600';
            case 'negative': return 'text-rose-600';
            default: return 'text-sky-600';
        }
    };

    return (
        // Reduced padding from p-6 to p-4
        <div className={`rounded-2xl shadow-xl border p-4 hover:shadow-xl transition-shadow duration-300 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between">
                <div>
                    {/* Reduced font size from text-sm to text-xs */}
                    <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{title}</p>
                    {/* Reduced font size from text-2xl to text-xl */}
                    <h3 className={`text-xl font-bold mt-1 ${sentiment ? getSentimentColor(sentiment) : (isDarkMode ? 'text-gray-100' : 'text-slate-900')}`}>
                        {value}
                    </h3>
                </div>
                {/* Reduced padding from p-3 to p-2 and icon size from w-6/h-6 to w-5/h-5 */}
                <div className={`${bgColor} p-2 rounded-xl`}>
                    {React.cloneElement(icon as React.ReactElement, { size: 20 })}
                </div>
            </div>
        </div>
    );
};


export default function AgentCallHistory({ user, isDarkMode }: AgentCallHistoryProps) {
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
    const [calls, setCalls] = useState<CallRecord[]>([]);
    const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
    const [showCalendar, setShowCalendar] = useState(false);
    const [audioPlaying, setAudioPlaying] = useState<string | null>(null);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const [lastVisible, setLastVisible] = useState<any>(null);
    const [hasMore, setHasMore] = useState(true);

    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const calendarModalRef = useRef<HTMLDivElement>(null); // <--- ADDED: Ref for the inner calendar modal

    // Initial load/stat fetch effects remain the same

    useEffect(() => {
        if (!user?.email) return;

        const fetchAgentStats = async () => {
            try {
                const agentsRef = collection(db, 'agents');
                const agentQuery = query(agentsRef, where('email', '==', user.email));
                const agentSnapshot = await getDocs(agentQuery);

                if (!agentSnapshot.empty) {
                    const agentDoc = agentSnapshot.docs[0];
                    const agentData = agentDoc.data();
                    setAgentStats(agentData.stats || {
                        totalCalls: 0,
                        overallScore: 0,
                        lastCallDate: Timestamp.now(),
                        avgDuration: 0
                    });
                }
            } catch (err) {
                console.error('Error fetching agent stats:', err);
                setError('Failed to load agent statistics');
            }
        };

        fetchAgentStats();
    }, [user.email]);

    useEffect(() => {
        if (!user?.email) return;

        let unsubscribe: (() => void) | undefined;

        const setupCallsListener = async () => {
            try {
                setLoading(true);
                setError(null);

                let callsQuery = query(
                    collection(db, 'call_analysis'),
                    where('agentEmail', '==', user.email),
                    orderBy('timestamp', 'desc'),
                    limit(ITEMS_PER_PAGE * 2)
                );

                if (dateFilter !== 'all') {
                    const dateRange = getDateRange(dateFilter);
                    if (dateRange) {
                        callsQuery = query(
                            callsQuery,
                            where('timestamp', '>=', dateRange.start),
                            where('timestamp', '<=', dateRange.end)
                        );
                    }
                }

                unsubscribe = onSnapshot(callsQuery,
                    (snapshot) => {
                        const callsData = snapshot.docs.map(doc => {
                            const data = doc.data();
                            return {
                                id: doc.id,
                                ...data,
                                duration: data.duration || 0,
                                overallScore: data.overallScore || 0,
                                scores: data.scores || {},
                                callAnalysis: data.callAnalysis || {},
                                callSections: data.callSections || {},
                                metadata: data.metadata || {},
                                objections: data.objections || [],
                                competitors: data.competitors || [],
                                coachingTips: data.coachingTips || [],
                                keyTopics: data.keyTopics || [],
                                sentiment: data.sentiment || 'neutral',
                                fillerWords: data.fillerWords || 0,
                                talkRatio: data.talkRatio || '0%',
                                holdTime: data.holdTime || 0,
                                summary: data.summary || '',
                                language: data.language || 'English',
                                callType: data.callType || {
                                    primary: 'Unknown',
                                    subCategory: 'N/A',
                                    confidence: 0,
                                    secondary: []
                                },
                                // MAP TONE ANALYSIS HERE
                                toneAnalysis: data.toneAnalysis || {
                                    agentMood: 'N/A',
                                    customerMood: 'N/A',
                                    toneMark: 0,
                                    reasoning: 'No acoustic data available.'
                                }
                            } as CallRecord;
                        });

                        setCalls(callsData);
                        setHasMore(snapshot.docs.length === ITEMS_PER_PAGE * 2);
                        setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
                        setLoading(false);
                    },
                    (err) => {
                        console.error('Error listening to calls:', err);
                        setError('Failed to load call data');
                        setLoading(false);
                    }
                );
            } catch (err) {
                console.error('Error setting up listener:', err);
                setError('Failed to initialize data loading');
                setLoading(false);
            }
        };

        setupCallsListener();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [user.email, dateFilter, customStartDate, customEndDate]); // Added custom dates to dependency array to trigger re-fetch on apply

    // MODIFIED: Simplified handleClickOutside to handle only dropdowns/menus, 
    // relying on the modal's backdrop handler for the calendar
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
                setShowFilterDropdown(false);
            }
            // Removed: if (showCalendar) { setShowCalendar(false); }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []); // Removed dependency on showCalendar

    useEffect(() => {
        return () => {
            if (audioElement) {
                audioElement.pause();
                audioElement.currentTime = 0;
            }
        };
    }, [audioElement]);

    const formatDuration = (seconds: number): string => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (timestamp: Timestamp | { seconds: number; nanoseconds: number }) => {
        if (!timestamp) return { date: 'N/A', time: 'N/A' };

        try {
            let date: Date;

            if (typeof (timestamp as any).toDate === 'function') {
                date = (timestamp as Timestamp).toDate();
            } else if (typeof (timestamp as any).seconds === 'number') {
                date = new Date((timestamp as any).seconds * 1000);
            } else if (typeof timestamp === 'number') {
                date = new Date(timestamp * 1000);
            } else {
                return { date: 'Invalid Date', time: 'Invalid Time' };
            }

            if (isNaN(date.getTime())) {
                return { date: 'N/A', time: 'N/A' };
            }

            return {
                date: date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }),
                time: date.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
            };
        } catch (error) {
            console.error('Error formatting date:', error);
            return { date: 'Error', time: 'Error' };
        }
    };

    const formatDateFromUnix = (timestamp: string | number | Timestamp) => {
        if (!timestamp) return { date: 'N/A', time: 'N/A' };

        try {
            let date: Date;

            if (typeof timestamp === 'string') {
                const unixTime = parseInt(timestamp);
                date = new Date(unixTime * 1000);
            } else if (typeof timestamp === 'number') {
                date = new Date(timestamp * 1000);
            } else {
                date = timestamp.toDate();
            }

            if (isNaN(date.getTime())) {
                return { date: 'N/A', time: 'N/A' };
            }

            return {
                date: date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                }),
                time: date.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
            };
        } catch (error) {
            console.error('Error formatting Unix date:', error);
            return { date: 'Error', time: 'Error' };
        }
    };

    const getLanguageColor = (language: string) => {
        return LANGUAGE_COLORS[language as keyof typeof LANGUAGE_COLORS] || LANGUAGE_COLORS.Other;
    };

    const getDateRange = (filter: DateFilter) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (filter) {
            case 'today':
                return {
                    start: Timestamp.fromDate(today),
                    end: Timestamp.fromDate(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1))
                };
            case 'yesterday':
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                return {
                    start: Timestamp.fromDate(yesterday),
                    end: Timestamp.fromDate(today)
                };
            case 'week':
                const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                return {
                    start: Timestamp.fromDate(weekAgo),
                    end: Timestamp.fromDate(now)
                };
            case 'month':
                const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
                return {
                    start: Timestamp.fromDate(monthAgo),
                    end: Timestamp.fromDate(now)
                };
            case 'custom':
                if (customStartDate && customEndDate) {
                    return {
                        start: Timestamp.fromDate(new Date(customStartDate)),
                        // Set end date to the end of the selected day
                        end: Timestamp.fromDate(new Date(new Date(customEndDate).getTime() + 24 * 60 * 60 * 1000 - 1))
                    };
                }
                return null;
            default:
                return null;
        }
    };

    const filteredAndSortedCalls = useMemo(() => {
        const sorted = [...calls].sort((a, b) => {
            let aValue: any, bValue: any;

            switch (sortField) {
                case 'date':
                    aValue = a.timestamp ? a.timestamp.toDate().getTime() : 0;
                    bValue = b.timestamp ? b.timestamp.toDate().getTime() : 0;
                    break;
                case 'score':
                    aValue = a.overallScore || 0;
                    bValue = b.overallScore || 0;
                    break;
                case 'duration':
                    aValue = a.duration || 0;
                    bValue = b.duration || 0;
                    break;
                default:
                    return 0;
            }

            if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    }, [calls, sortField, sortDirection]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
        setCurrentPage(1);
    };

    const getTotalDuration = () => {
        const total = filteredAndSortedCalls.reduce((acc, call) => {
            return acc + (call.duration || 0);
        }, 0);
        const totalMinutes = Math.floor(total / 60);
        const totalSeconds = total % 60;
        return `${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
    };

    const getAverageScore = () => {
        if (filteredAndSortedCalls.length === 0) return '0.0';
        const total = filteredAndSortedCalls.reduce((acc, call) => {
            return acc + (call.overallScore || 0);
        }, 0);
        return (total / filteredAndSortedCalls.length).toFixed(1);
    };

    const playAudio = (callId: string, audioUrl: string) => {
        if (audioElement) {
            audioElement.pause();
            if (audioPlaying === callId) {
                setAudioPlaying(null);
                return;
            }
        }

        if (!audioUrl) {
            alert('No audio URL available for this call.');
            return;
        }

        const audio = new Audio(audioUrl);
        audio.play()
            .then(() => {
                setAudioElement(audio);
                setAudioPlaying(callId);
            })
            .catch(e => {
                console.error('Failed to play audio:', e);
                alert('Could not play the audio. The file may be unavailable or in an unsupported format.');
                setAudioPlaying(null);
            });

        audio.onended = () => setAudioPlaying(null);
        audio.onerror = () => {
            setAudioPlaying(null);
            alert('Error playing audio file.');
        };
    };

    const selectedFilterLabel = dateFilterOptions.find(option => option.value === dateFilter)?.label || 'All Time';

    const handleViewAnalytics = (call: CallRecord) => {
        setSelectedCall(call);
        setViewMode('analytics');
    };

    const handleBackToList = () => {
        setViewMode('list');
        setSelectedCall(null);
    };

    const handleCustomDateApply = () => {
        if (customStartDate && customEndDate) {
            // Check if the end date is before the start date
            if (new Date(customStartDate) > new Date(customEndDate)) {
                alert('Start date cannot be after the end date.');
                return;
            }
            setDateFilter('custom');
            setShowCalendar(false);
            setShowFilterDropdown(false);
            setCurrentPage(1);
        } else {
             alert('Please select both a start and end date.');
        }
    };

    const totalPages = Math.ceil(filteredAndSortedCalls.length / ITEMS_PER_PAGE);
    const currentCalls = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredAndSortedCalls.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredAndSortedCalls, currentPage]);

    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const prepareScoreData = (call: CallRecord) => {
        if (!call.scores) return [];
        
        // Add Tone Mark to the score data for the radar chart
        const scoreEntries = Object.entries(call.scores).map(([key, value]) => ({
            subject: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
            A: value || 0,
            fullMark: 10,
        }));

        scoreEntries.push({
            subject: 'Tone Mark',
            A: call.toneAnalysis?.toneMark || 0,
            fullMark: 10,
        });
        
        return scoreEntries;
    };

    const prepareCallSectionData = (call: CallRecord) => {
        if (!call.callSections) return [];
        return Object.entries(call.callSections).map(([key, value]) => ({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            present: value?.present || false,
            summary: value?.summary || 'No summary available',
        }));
    };

    const prepareCallAnalysisData = (call: CallRecord) => {
        if (!call.callAnalysis) return [];
        return Object.entries(call.callAnalysis).map(([key, value]) => ({
            name: key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            value: value || false,
        }));
    };

    if (loading && calls.length === 0) {
        return (
            <div className={`min-h-screen p-6 flex items-center justify-center ${isDarkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100'}`}>
                <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    const getChartColors = (isDarkMode: boolean) => ({
        stroke: isDarkMode ? '#e2e8f0' : '#6b7280',
        grid: isDarkMode ? '#475569' : '#e5e7eb',
    });

    const chartColors = getChartColors(isDarkMode);

    // Mobile-friendly call card component
    const CallCard = ({ call }: { call: CallRecord }) => {
        const { date, time } = formatDate(call.timestamp);

        return (
            <div className={`rounded-xl border p-4 mb-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                <div className="flex flex-col space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-indigo-900 text-indigo-400' : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white'}`}>
                                <span className="text-sm font-medium">{call.agentName?.charAt(0) || 'A'}</span>
                            </div>
                            <div>
                                <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                    {call.agentName || 'Unknown Agent'}
                                </div>
                                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                    {date} at {time}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                {call.overallScore || 0}/10
                            </div>
                            <div className="w-12 h-1 rounded-full bg-slate-200 mt-1">
                                <div
                                    className="bg-gradient-to-r from-emerald-400 to-sky-500 h-1 rounded-full"
                                    style={{ width: `${(call.overallScore || 0) * 10}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>

                    {/* Call Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Caller</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{call.caller || 'N/A'}</div>
                        </div>
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Duration</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{formatDuration(call.duration)}</div>
                        </div>
                        <div className="col-span-2">
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Call Type</div>
                            <div className="flex items-center space-x-2">
                                <span className={`text-sm font-medium ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>
                                    {call.callType?.primary || 'Unknown'}
                                </span>
                                <span className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-slate-100 text-slate-600'}`}>
                                    {call.callType?.subCategory || 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex space-x-2 pt-2">
                        {call.recordingUrl ? (
                            <button
                                onClick={() => playAudio(call.id, call.recordingUrl)}
                                className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg transition-colors text-xs font-medium ${
                                    audioPlaying === call.id
                                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                }`}
                            >
                                {audioPlaying === call.id ? (
                                    <><Pause className="w-3 h-3 mr-1" /> Pause</>
                                ) : (
                                    <><Play className="w-3 h-3 mr-1" /> Play</>
                                )}
                            </button>
                        ) : (
                            <button
                                disabled
                                className="flex-1 flex items-center justify-center px-3 py-2 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed text-xs font-medium"
                            >
                                <Play className="w-3 h-3 mr-1" /> No Audio
                            </button>
                        )}
                        <button
                            onClick={() => handleViewAnalytics(call)}
                            className="flex-1 flex items-center justify-center px-3 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-xs font-medium"
                        >
                            <BarChart3 className="w-3 h-3 mr-1" /> Analyze
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    if (viewMode === 'analytics' && selectedCall) {
        const scoreData = prepareScoreData(selectedCall);
        const callSectionData = prepareCallSectionData(selectedCall);
        const callAnalysisData = prepareCallAnalysisData(selectedCall);
        const { date, time } = formatDate(selectedCall.timestamp);

        return (
            <div className={`min-h-screen p-4 sm:p-6 ${isDarkMode ? 'bg-gray-900 text-gray-100' : 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-100'}`}>
                <div className="max-w-7xl mx-auto">
                    <div className="mb-6">
                        <button
                            onClick={handleBackToList}
                            className={`flex items-center font-semibold transition-colors ${isDarkMode ? 'text-indigo-400 hover:text-indigo-200' : 'text-indigo-700 hover:text-indigo-900'}`}
                        >
                            <ArrowRight className="w-5 h-5 rotate-180 mr-2" />
                            Back to call list
                        </button>
                    </div>

                    <div className={`rounded-3xl shadow-2xl border p-4 sm:p-8 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                        {/* Header Section */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 pb-4 border-b border-slate-200">
                            <div className="mb-4 sm:mb-0">
                                <h2 className={`text-2xl sm:text-3xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>Call Analysis</h2>
                                <p className={`mt-1 text-sm sm:text-base ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                    Call on <span className="font-semibold">{date}</span> at <span className="font-semibold">{time}</span>
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-start sm:justify-start space-x-2 sm:space-x-4 w-full sm:w-auto">
                                <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm ${isDarkMode ? 'bg-gray-700' : 'bg-slate-100'}`}>
                                    <Globe className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`} />
                                    <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                                        Language: <span style={{ color: getLanguageColor(selectedCall.language) }} className="font-bold">
                                            {selectedCall.language || 'English'}
                                        </span>
                                    </span>
                                </div>
                                {selectedCall.recordingUrl ? (
                                    <button
                                        onClick={() => playAudio(selectedCall.id, selectedCall.recordingUrl)}
                                        className={`flex items-center px-4 sm:px-6 py-2 sm:py-3 rounded-xl transition-all duration-300 font-medium text-white shadow-lg ${
                                            audioPlaying === selectedCall.id
                                                ? 'bg-red-600 hover:bg-red-700'
                                                : 'bg-indigo-600 hover:bg-indigo-700'
                                        }`}
                                        title='Play recording'
                                    >
                                        {audioPlaying === selectedCall.id ? (
                                            <>
                                                <Pause className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                                                <span className="hidden sm:inline">Pause</span>
                                            </>
                                        ) : (
                                            <>
                                                <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                                                <span className="hidden sm:inline">Play Recording</span>
                                            </>
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        disabled
                                        className="flex items-center px-4 sm:px-6 py-2 sm:py-3 bg-gray-400 text-white rounded-xl cursor-not-allowed shadow-md text-sm sm:text-base"
                                        title="Audio not available"
                                    >
                                        <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                                        <span className="hidden sm:inline">No Audio</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Call Type Classification */}
                        <div className={`rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 shadow-inner border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gradient-to-br from-slate-50 to-indigo-50 border-slate-200'}`}>
                            <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                <Tags className="w-5 h-5 mr-2 text-indigo-600" />
                                Call Classification
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                                <div className={`p-3 sm:p-4 rounded-lg border-l-4 ${isDarkMode ? 'bg-gray-700 border-blue-500' : 'bg-blue-50 border-blue-500'}`}>
                                    <p className={`text-xs sm:text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>Primary Category</p>
                                    <p className={`text-base sm:text-lg font-bold ${isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>{selectedCall.callType?.primary || 'N/A'}</p>
                                </div>
                                <div className={`p-3 sm:p-4 rounded-lg border-l-4 ${isDarkMode ? 'bg-gray-700 border-purple-500' : 'bg-purple-50 border-purple-500'}`}>
                                    <p className={`text-xs sm:text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>Sub Category</p>
                                    <p className={`text-base sm:text-lg font-bold ${isDarkMode ? 'text-purple-300' : 'text-purple-800'}`}>{selectedCall.callType?.subCategory || 'N/A'}</p>
                                </div>
                                <div className={`p-3 sm:p-4 rounded-lg border-l-4 ${isDarkMode ? 'bg-gray-700 border-teal-500' : 'bg-teal-50 border-teal-500'}`}>
                                    <p className={`text-xs sm:text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>Confidence</p>
                                    <p className={`text-base sm:text-lg font-bold ${isDarkMode ? 'text-teal-300' : 'text-teal-800'}`}>{(selectedCall.callType?.confidence * 100).toFixed(1) || '0.0'}%</p>
                                </div>
                            </div>

                            {/* Secondary Categories */}
                            {selectedCall.callType?.secondary && selectedCall.callType.secondary.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-slate-200">
                                    <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Secondary Topics</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedCall.callType.secondary.map((topic, index) => (
                                            <span key={index} className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${isDarkMode ? 'bg-yellow-900/40 border-yellow-500/30 text-yellow-400' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}`}>
                                                {topic}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Main Stats Grid - MODIFIED to include Tone Mark */}
                        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6 mb-6 sm:mb-8">
                            <StatCard
                                title="Overall Score"
                                value={`${selectedCall.overallScore || 0}/10`}
                                icon={<Award className="w-5 h-5 text-purple-600" />}
                                bgColor="bg-purple-100"
                                trend="up"
                                isDarkMode={isDarkMode}
                            />
                            {/* ADDED TONE MARK STAT CARD */}
                            <StatCard
                                title="Tone Mark"
                                value={`${selectedCall.toneAnalysis?.toneMark || 0}/10`}
                                icon={<Mic className="w-5 h-5 text-pink-600" />}
                                bgColor="bg-pink-100"
                                isDarkMode={isDarkMode}
                            />
                            <StatCard
                                title="Duration"
                                value={formatDuration(selectedCall.duration)}
                                icon={<Clock className="w-5 h-5 text-blue-600" />}
                                bgColor="bg-blue-100"
                                isDarkMode={isDarkMode}
                            />
                            <StatCard
                                title="Sentiment"
                                value={selectedCall.sentiment?.charAt(0).toUpperCase() + selectedCall.sentiment?.slice(1) || 'Neutral'}
                                icon={<Heart className="w-5 h-5 text-green-600" />}
                                bgColor="bg-green-100"
                                sentiment={selectedCall.sentiment}
                                isDarkMode={isDarkMode}
                            />
                            <StatCard
                                title="Filler Words"
                                value={selectedCall.fillerWords?.toString() || '0'}
                                icon={<MessageCircle className="w-5 h-5 text-orange-600" />}
                                bgColor="bg-orange-100"
                                isDarkMode={isDarkMode}
                            />
                        </div>

                        {/* Performance Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 mb-8 sm:mb-10">
                            {/* Radar Chart: Scores (Updated to include Tone Mark) */}
                            <div className={`rounded-2xl p-4 sm:p-6 shadow-inner border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gradient-to-br from-slate-50 to-blue-50 border-slate-200'}`}>
                                <h3 className={`text-base sm:text-lg font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-800'}`}>
                                    <Target className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-indigo-600" />
                                    Performance Scores Radar
                                </h3>
                                <div className="h-64 sm:h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={scoreData}>
                                            <PolarGrid stroke={chartColors.grid} />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: chartColors.stroke, fontSize: 10, fontWeight: 500 }} />
                                            <PolarRadiusAxis angle={90} domain={[0, 10]} stroke={chartColors.grid} tickCount={6} />
                                            <Radar name="Scores" dataKey="A" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.7} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : 'rgba(255, 255, 255, 0.95)', border: 'none', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', backdropFilter: 'blur(8px)', color: isDarkMode ? '#e2e8f0' : '#1f2937' }}
                                            />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* ADDED: Tone Analysis Detail Card */}
                            <div className={`rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                    <Volume2 className="w-5 h-5 mr-2 text-pink-600" />
                                    Acoustic Tone Analysis
                                </h3>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-pink-50 border-pink-200'}`}>
                                            <p className={`text-xs font-semibold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>Agent Mood</p>
                                            <p className={`text-sm font-bold mt-1 ${isDarkMode ? 'text-pink-300' : 'text-pink-800'}`}>{selectedCall.toneAnalysis?.agentMood || 'N/A'}</p>
                                        </div>
                                        <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-indigo-50 border-indigo-200'}`}>
                                            <p className={`text-xs font-semibold ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>Customer Mood</p>
                                            <p className={`text-sm font-bold mt-1 ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>{selectedCall.toneAnalysis?.customerMood || 'N/A'}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 flex items-center ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>
                                            Tone Reasoning
                                        </h4>
                                        <p className={`text-xs sm:text-sm leading-relaxed p-3 sm:p-4 rounded-lg border shadow-sm ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                                            {selectedCall.toneAnalysis?.reasoning || 'LLM analysis summary not available.'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Detailed Analysis Sections */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 mb-6 sm:mb-8">
                            {/* Call Sections Summary */}
                            <div className={`lg:col-span-2 rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                    <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-600" />
                                    Call Sections Breakdown
                                </h3>
                                <div className="space-y-4">
                                    {callSectionData.map((section, index) => (
                                        <div key={index} className={`p-3 sm:p-4 rounded-lg border-l-4 transition-all duration-300 hover:shadow-md ${isDarkMode ? (section.present ? 'bg-green-900/30' : 'bg-red-900/30') : (section.present ? 'bg-green-50' : 'bg-red-50')}`}
                                            style={{
                                                borderLeftColor: section.present ? '#10B981' : '#EF4444',
                                            }}>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className={`text-sm sm:text-base font-semibold ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>{section.name} Section</h4>
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                    section.present ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                                }`}>
                                                    {section.present ? '✓ Present' : '✗ Missing'}
                                                </span>
                                            </div>
                                            <p className={`text-xs sm:text-sm leading-relaxed p-2 sm:p-3 rounded border ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                                                {section.summary}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Quick Analysis */}
                            <div className={`rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                    <Shield className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-green-600" />
                                    Call Quality Metrics
                                </h3>
                                <div className="space-y-3 sm:space-y-4">
                                    {callAnalysisData.map((item, index) => (
                                        <div key={index} className={`flex items-center justify-between p-2 sm:p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-slate-50'}`}>
                                            <span className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>{item.name}</span>
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                item.value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                                {item.value ? 'Yes' : 'No'}
                                            </span>
                                        </div>
                                    ))}
                                    <div className={`flex items-center justify-between p-2 sm:p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-slate-50'}`}>
                                        <span className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Talk Ratio</span>
                                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                                            {selectedCall.talkRatio || 'N/A'}
                                        </span>
                                    </div>
                                    <div className={`flex items-center justify-between p-2 sm:p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-slate-50'}`}>
                                        <span className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Hold Time</span>
                                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800">
                                            {selectedCall.holdTime || 0}s
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Summary & Coaching Tips */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                            <div className={`rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gradient-to-br from-white to-blue-50 border-slate-200'}`}>
                                <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                    <Star className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-yellow-600" />
                                    Summary & Key Insights
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Call Summary</h4>
                                        <p className={`text-xs sm:text-sm leading-relaxed p-3 sm:p-4 rounded-lg border shadow-sm ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-slate-200 text-slate-800'}`}>
                                            {selectedCall.summary || 'No summary available.'}
                                        </p>
                                    </div>
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Key Topics</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedCall.keyTopics?.map((topic, index) => (
                                                <span key={index} className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${isDarkMode ? 'bg-indigo-900/40 border-indigo-500/30 text-indigo-400' : 'bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border-indigo-200'}`}>
                                                    {topic}
                                                </span>
                                            ))}
                                            {(!selectedCall.keyTopics || selectedCall.keyTopics.length === 0) && (
                                                <span className={`${isDarkMode ? 'text-gray-500' : 'text-slate-500'} text-sm`}>No topics available</span>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Objections Mentioned</h4>
                                        <ul className={`list-disc list-inside text-xs sm:text-sm space-y-1 p-2 sm:p-3 rounded-lg ${isDarkMode ? 'bg-red-900/30 text-red-300' : 'bg-rose-50 text-slate-800'}`}>
                                            {selectedCall.objections?.map((objection, index) => (
                                                <li key={index} className="leading-relaxed">{objection}</li>
                                            ))}
                                            {(!selectedCall.objections || selectedCall.objections.length === 0) && (
                                                <li className={`${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>No objections recorded.</li>
                                            )}
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className={`rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gradient-to-br from-white to-purple-50 border-slate-200'}`}>
                                <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                    <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-purple-600" />
                                    Coaching & Development
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Key Coaching Tips</h4>
                                        <ul className="space-y-2">
                                            {selectedCall.coachingTips?.map((tip, index) => (
                                                <li key={index} className={`flex items-start p-2 sm:p-3 rounded-lg border ${isDarkMode ? 'bg-purple-900/30 border-purple-500/30' : 'bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200'}`}>
                                                    <span className="flex-shrink-0 w-4 h-4 sm:w-5 sm:h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-bold mr-2 sm:mr-3 mt-0.5">
                                                        {index + 1}
                                                    </span>
                                                    <span className={`text-xs sm:text-sm leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>{tip}</span>
                                                </li>
                                            ))}
                                            {(!selectedCall.coachingTips || selectedCall.coachingTips.length === 0) && (
                                                <li className={`text-xs sm:text-sm p-2 sm:p-3 rounded-lg ${isDarkMode ? 'text-gray-500 bg-gray-700' : 'text-slate-500 bg-slate-50'}`}>No coaching tips available.</li>
                                            )}
                                        </ul>
                                    </div>
                                    <div>
                                        <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Competitors Mentioned</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedCall.competitors?.map((competitor, index) => (
                                                <span key={index} className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${isDarkMode ? 'bg-red-900/30 border-red-500/30 text-red-400' : 'bg-red-100 text-red-800 border-red-200'}`}>
                                                    {competitor}
                                                </span>
                                            ))}
                                            {(!selectedCall.competitors || selectedCall.competitors.length === 0) && (
                                                <span className={`${isDarkMode ? 'text-gray-500' : 'text-slate-500'} text-sm`}>No competitors mentioned</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen p-4 sm:p-6 ${isDarkMode ? 'bg-gray-900 text-gray-100' : 'bg-gradient-to-br from-purple-50 to-indigo-100'}`}>
            <div className="max-w-7xl mx-auto">
                {/* Header Section */}
                <div className="mb-8">
                    <div className={`rounded-2xl sm:rounded-3xl shadow-xl sm:shadow-2xl border p-6 sm:p-8 relative ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                        <div className={`absolute top-0 right-0 w-48 h-48 rounded-bl-full opacity-60 transform translate-x-1/4 -translate-y-1/4 ${isDarkMode ? 'bg-gradient-to-tr from-indigo-800 to-purple-800' : 'bg-gradient-to-tr from-indigo-200 to-purple-200'}`}></div>
                        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center space-x-4">
                                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-3 sm:p-4 rounded-full shadow-lg">
                                    <Phone className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                                </div>
                                <div>
                                    <h1 className={`text-xl sm:text-3xl font-extrabold mb-1 ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>My Call History</h1>
                                    <p className={`text-sm sm:text-base ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Review and analyze your call performance</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center space-x-2 sm:space-x-3 mt-4 sm:mt-0">
                                {/* Date Filter */}
                                <div className="relative z-50" ref={filterDropdownRef}>
                                    <button
                                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                        className={`flex items-center space-x-2 px-4 sm:px-6 py-2 sm:py-3 border rounded-xl shadow-sm transition-all duration-200 font-medium hover:shadow-md text-sm sm:text-base ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                                    >
                                        <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
                                        <span>{selectedFilterLabel}</span>
                                        <ChevronDown className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform duration-200 ${showFilterDropdown ? 'transform rotate-180' : ''}`} />
                                    </button>
                                    {showFilterDropdown && (
                                        <div className={`absolute right-0 top-full mt-2 w-48 sm:w-56 rounded-xl shadow-lg z-50 overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                            {dateFilterOptions.map(option => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => {
                                                        if (option.value === 'custom') {
                                                            setShowCalendar(true);
                                                        } else {
                                                            setDateFilter(option.value as DateFilter);
                                                            setShowFilterDropdown(false);
                                                            setCurrentPage(1);
                                                        }
                                                    }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${dateFilter === option.value ? 'bg-purple-50 text-purple-700 font-semibold' : (isDarkMode ? 'text-gray-300' : 'text-slate-700')}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full ${option.color} mr-3`}></span>
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Calendar Modal (FIXED LOGIC) */}
                {showCalendar && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" 
                        onClick={(e) => {
                            // Only close if the click is on the backdrop itself
                            if (e.target === e.currentTarget) {
                                setShowCalendar(false);
                            }
                        }}
                    >
                        <div 
                            ref={calendarModalRef} // <-- APPLY THE NEW REF HERE
                            className={`rounded-xl p-6 w-full max-w-sm ${isDarkMode ? 'bg-gray-800 text-gray-100' : 'bg-white'}`} 
                            onClick={(e) => e.stopPropagation()} // Stop propagation so clicks inside don't trigger backdrop close
                        >
                            <h3 className="text-lg font-semibold mb-4">Select Date Range</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Start Date</label>
                                    <input
                                        type="date"
                                        value={customStartDate}
                                        onChange={(e) => setCustomStartDate(e.target.value)}
                                        className={`w-full p-2 border rounded-md ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300'}`}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>End Date</label>
                                    <input
                                        type="date"
                                        value={customEndDate}
                                        onChange={(e) => setCustomEndDate(e.target.value)}
                                        className={`w-full p-2 border rounded-md ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300'}`}
                                    />
                                </div>
                                <div className="flex justify-end space-x-3 pt-4">
                                    <button
                                        onClick={() => { setShowCalendar(false); setShowFilterDropdown(false); }}
                                        className={`px-4 py-2 rounded-md ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'}`}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleCustomDateApply}
                                        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                                    >
                                        Apply
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
                        <p className="text-red-700 font-medium">{error}</p>
                    </div>
                )}

                {/* Stats Cards (Reduced Size) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
                    <StatCard
                        title="Total Calls"
                        value={agentStats?.totalCalls || filteredAndSortedCalls.length}
                        icon={<Phone className="w-5 h-5 text-indigo-600" />}
                        bgColor="bg-indigo-100"
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        title="Total Duration"
                        value={getTotalDuration()}
                        icon={<Clock className="w-5 h-5 text-emerald-600" />}
                        bgColor="bg-emerald-100"
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        title="Avg. Score"
                        value={agentStats?.overallScore ? agentStats.overallScore.toFixed(1) : getAverageScore()}
                        icon={<TrendingUp className="w-5 h-5 text-rose-600" />}
                        bgColor="bg-rose-100"
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        title="Filtered Calls"
                        value={filteredAndSortedCalls.length}
                        icon={<User_Icon className="w-5 h-5 text-fuchsia-600" />}
                        bgColor="bg-fuchsia-100"
                        isDarkMode={isDarkMode}
                    />
                </div>

                {/* Calls Display - Mobile Cards / Desktop Table */}
                <div className={`rounded-2xl shadow-xl overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                    <div className={`px-4 sm:px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-slate-200'}`}>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>My Call Records</h3>
                            <div className="flex flex-wrap items-center space-x-2">
                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Sort by:</span>
                                <div className={`flex rounded-lg p-1 ${isDarkMode ? 'bg-gray-700' : 'bg-slate-100'}`}>
                                    <button
                                        onClick={() => handleSort('date')}
                                        className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'date' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                                    >
                                        Date
                                        {sortField === 'date' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                    <button
                                        onClick={() => handleSort('score')}
                                        className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'score' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                                    >
                                        Score
                                        {sortField === 'score' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                    <button
                                        onClick={() => handleSort('duration')}
                                        className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'duration' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                                    >
                                        Duration
                                        {sortField === 'duration' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Mobile View - Cards */}
                    <div className="block sm:hidden p-4">
                        {currentCalls.length === 0 ? (
                            <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                <Phone className={`w-12 h-12 mx-auto mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No calls found</p>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters</p>
                            </div>
                        ) : (
                            currentCalls.map((call) => (
                                <CallCard key={call.id} call={call} />
                            ))
                        )}
                    </div>

                    {/* Desktop View - Table */}
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="min-w-full table-auto">
                            <thead className={`border-b ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-slate-50 border-slate-200'}`}>
                                <tr>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Caller/Called</th>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Date & Time</th>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Call Type</th>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Duration</th>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Score</th>
                                    <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Actions</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-white divide-slate-200'}`}>
                                {currentCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className={`px-6 py-8 text-center ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                            <div className="flex flex-col items-center justify-center">
                                                <Phone className={`w-12 h-12 mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No calls found</p>
                                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters to see more results</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    currentCalls.map((call) => {
                                        const { date, time } = formatDateFromUnix(call.metadata?.starttime || call.timestamp);
                                        return (
                                            <tr key={call.id} className={`transition-all duration-150 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'}`}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{call.caller || 'N/A'}</div>
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>to {call.dialed || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{date}</div>
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{time}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>
                                                        {call.callType?.primary || 'Unknown'}
                                                    </div>
                                                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                                        {call.callType?.subCategory || 'No sub-category'}
                                                    </div>
                                                </td>
                                                <td className={`px-6 py-4 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                    {formatDuration(call.duration)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex flex-col items-start">
                                                        <div className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{call.overallScore || 0}/10</div>
                                                        <div className={`w-16 h-2 rounded-full ${isDarkMode ? 'bg-gray-600' : 'bg-slate-200'}`}>
                                                            <div className="bg-gradient-to-r from-emerald-400 to-sky-500 h-2 rounded-full" style={{ width: `${(call.overallScore || 0) * 10}%` }}></div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <div className="flex items-center space-x-2">
                                                        {call.recordingUrl ? (
                                                            <button
                                                                onClick={() => playAudio(call.id, call.recordingUrl)}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg transition-colors text-xs ${audioPlaying === call.id ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                                                                title='Play recording'
                                                            >
                                                                {audioPlaying === call.id ? (<><Pause className="w-3 h-3 mr-1" /> Pause</>) : (<><Play className="w-3 h-3 mr-1" /> Play</>)}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                disabled
                                                                className="flex items-center px-3 py-1.5 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed text-xs"
                                                                title="Audio not available"
                                                            >
                                                                <Play className="w-3 h-3 mr-1" /> No Audio
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleViewAnalytics(call)}
                                                            className="flex items-center px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-xs"
                                                        >
                                                            <BarChart3 className="w-3 h-3 mr-1" /> Analyze
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {filteredAndSortedCalls.length > 0 && (
                        <div className={`px-4 sm:px-6 py-4 border-t flex flex-col md:flex-row items-center justify-between gap-4 ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-slate-50 border-slate-200'}`}>
                            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedCalls.length)} of {filteredAndSortedCalls.length} calls
                            </span>
                            <div className="flex space-x-1">
                                <button
                                    onClick={() => goToPage(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className={`px-3 py-1 rounded-md text-sm font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-white border-slate-300 text-slate-700'}`}
                                >
                                    Previous
                                </button>
                                {[...Array(totalPages)].map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => goToPage(index + 1)}
                                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                                            currentPage === index + 1
                                                ? 'bg-blue-600 text-white'
                                                : `${isDarkMode ? 'bg-gray-800 text-blue-400 border border-gray-600 hover:bg-gray-700' : 'bg-white text-blue-600 border border-slate-300 hover:bg-blue-50'}`
                                        }`}
                                    >
                                        {index + 1}
                                    </button>
                                ))}
                                <button
                                    onClick={() => goToPage(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className={`px-3 py-1 rounded-md text-sm font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-white border-slate-300 text-slate-700'}`}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}