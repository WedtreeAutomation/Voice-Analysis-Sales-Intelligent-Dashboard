import { useState, useMemo, useEffect, useRef } from 'react';
import { collection, query, getDocs, orderBy, where, Timestamp, QueryConstraint } from 'firebase/firestore';
import { db } from '../../firebase';
import { Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { Phone, Filter, ChevronDown, Users, ArrowRight, Play, Pause, SortAsc, SortDesc, BarChart3, Clock, TrendingUp, MessageCircle, Target, Heart, Shield, Star, Award, Volume2, AlertCircle, Tags, Mic, X, PhoneOff, PhoneMissed, UserCheck, Hash, Activity, Zap, Download, Calendar, Check } from 'lucide-react';
import { User } from '../../types';

// Enhanced StatCard Component
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
        <div className={`rounded-2xl shadow-xl border p-6 hover:shadow-lg transition-shadow duration-300 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>{title}</p>
                    <h3 className={`text-2xl font-bold mt-1 ${sentiment ? getSentimentColor(sentiment) : (isDarkMode ? 'text-gray-100' : 'text-slate-900')}`}>
                        {value}
                    </h3>
                </div>
                <div className={`${bgColor} p-3 rounded-full`}>
                    {icon}
                </div>
            </div>
        </div>
    );
};

interface ManagerCallHistoryProps {
    user: User;
    isDarkMode: boolean;
    setActiveView: (view: any) => void;
}

interface CallType {
    primary: string;
    subCategory: string;
    confidence: number;
    secondary: string[];
}

interface CallScores {
    structure: number;
    clarity: number;
    confidence: number;
    closing: number;
    intro: number;
    call_summary: number;
    end_call: number;
    upselling: number;
    sympathy: number;
}

interface CallSection {
    summary: string;
    present: boolean;
}

interface CallAnalysis {
    company_intro_early: boolean;
    provided_summary: boolean;
    asked_for_more_queries: boolean;
    upselling_attempted: boolean;
    polite_language_used: boolean;
}

interface ToneAnalysis {
    agentMood: string;
    customerMood: string;
    toneMark: number;
    reasoning: string;
}

interface CallMetadata {
    circle: string;
    network: string;
    ringtime: string;
    startime: string;
    endtime: string;
    processedAt: Timestamp;
    audioExpiresAt: string;
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
    scores: CallScores;
    overallScore: number;
    coachingTips: string[];
    language: string;
    fillerWords: number;
    talkRatio: string;
    keyTopics: string[];
    sentiment: string;
    holdTime: number;
    callAnalysis: CallAnalysis;
    callSections: {
        intro: CallSection;
        discovery: CallSection;
        demo: CallSection;
        objection: CallSection;
        closure: CallSection;
    };
    metadata: CallMetadata;
    callType: CallType;
    toneAnalysis: ToneAnalysis;
    type_of_call: 'INCOMING' | 'C2C';
}

interface Agent {
    id: string;
    name: string;
    email: string;
    phone: string;
    stats: {
        totalCalls: number;
        overallScore: number;
        lastCallDate: Timestamp;
    };
}

interface MissedCall {
    call_id: string;
    caller: string;
    called: string;
    dialed: string;
    status: string;
    hangup_reason: string;
    timestamp: Timestamp;
    source: string;
    agent_type: string;
    circle: string;
    network: string;
    date?: string;
    callbackDone?: boolean;
    resolutionStatus?: 'Agent Callback' | 'Attended Later' | 'Pending';
    callbackAgent?: string;
}

interface FrequentCaller {
    phoneNumber: string;
    totalCalls: number;
    answeredCalls: number;
    missedCalls: number;
    lastCallDate: Timestamp;
    firstCallDate: Timestamp;
    avgScore?: number;
    topAgents: Array<{
        agentName: string;
        count: number;
    }>;
    callPurposes: Array<{
        purpose: string;
        count: number;
    }>;
    sentimentDistribution: {
        positive: number;
        negative: number;
        neutral: number;
    };
    averageDuration: number;
    callFrequency: 'daily' | 'weekly' | 'monthly' | 'occasional';
}

type DateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';
type ViewMode = 'list' | 'analytics';
type SortField = 'agentName' | 'date' | 'score' | 'duration';
type SortDirection = 'asc' | 'desc';
type CallView = 'answered' | 'missed' | 'frequent';

const dateFilterOptions = [
    { value: 'all', label: 'All Time', color: 'bg-slate-500' },
    { value: 'today', label: 'Today', color: 'bg-blue-500' },
    { value: 'yesterday', label: 'Yesterday', color: 'bg-indigo-500' },
    { value: 'week', label: 'Past Week', color: 'bg-purple-500' },
    { value: 'month', label: 'Past Month', color: 'bg-fuchsia-500' },
    { value: 'custom', label: 'Custom Range', color: 'bg-pink-500' },
];

const ITEMS_PER_PAGE = 10;

export default function ManagerCallHistory({isDarkMode }: ManagerCallHistoryProps) {
    const [selectedAgent, setSelectedAgent] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [callView, setCallView] = useState<CallView>('answered');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [showAgentDropdown, setShowAgentDropdown] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
    
    // Core data states
    const [agents, setAgents] = useState<Agent[]>([]);
    const [calls, setCalls] = useState<CallRecord[]>([]);
    const [rawMissedCalls, setRawMissedCalls] = useState<MissedCall[]>([]);
    
    const [loading, setLoading] = useState(true);
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [customStartDate, setCustomStartDate] = useState<string>('');
    const [customEndDate, setCustomEndDate] = useState<string>('');
    const [showCalendar, setShowCalendar] = useState(false);
    const [audioPlaying, setAudioPlaying] = useState<string | null>(null);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [minCallsThreshold, setMinCallsThreshold] = useState<number>(2); 

    const [callTypeFilter, setCallTypeFilter] = useState<'all' | 'INCOMING' | 'C2C'>('all');
    const [resolutionFilter, setResolutionFilter] = useState<'all' | 'Agent Callback' | 'Attended Later' | 'Pending'>('all');
    const [showCallTypeDropdown, setShowCallTypeDropdown] = useState(false);
    const [showResolutionDropdown, setShowResolutionDropdown] = useState(false);

    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const agentDropdownRef = useRef<HTMLDivElement>(null);
    const calendarModalRef = useRef<HTMLDivElement>(null);
    const callTypeDropdownRef = useRef<HTMLDivElement>(null);
    const resolutionDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // For custom range, only fetch once both dates are selected
        if (dateFilter === 'custom' && (!customStartDate || !customEndDate)) return;
        fetchAllData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateFilter, customStartDate, customEndDate]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) setShowFilterDropdown(false);
            if (agentDropdownRef.current && !agentDropdownRef.current.contains(event.target as Node)) setShowAgentDropdown(false);
            if (callTypeDropdownRef.current && !callTypeDropdownRef.current.contains(event.target as Node)) setShowCallTypeDropdown(false);
            if (resolutionDropdownRef.current && !resolutionDropdownRef.current.contains(event.target as Node)) setShowResolutionDropdown(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        return () => {
            if (audioElement) {
                audioElement.pause();
                audioElement.currentTime = 0;
            }
        };
    }, [audioElement]);

    // Resets page on view change
    useEffect(() => { setCurrentPage(1); }, [callView, dateFilter]);

    // Build Firestore date range constraints from current filter state.
    // Returns null when no date restriction should be applied (i.e. 'all').
    const buildDateConstraints = (): { start: Timestamp; end: Timestamp } | null => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (dateFilter) {
            case 'today':
                return {
                    start: Timestamp.fromDate(today),
                    end: Timestamp.fromDate(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)),
                };
            case 'yesterday': {
                const yStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                return {
                    start: Timestamp.fromDate(yStart),
                    end: Timestamp.fromDate(new Date(today.getTime() - 1)),
                };
            }
            case 'week':
                return {
                    start: Timestamp.fromDate(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)),
                    end: Timestamp.fromDate(now),
                };
            case 'month':
                return {
                    start: Timestamp.fromDate(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)),
                    end: Timestamp.fromDate(now),
                };
            case 'custom':
                if (customStartDate && customEndDate) {
                    return {
                        start: Timestamp.fromDate(new Date(customStartDate)),
                        end: Timestamp.fromDate(
                            new Date(new Date(customEndDate).getTime() + 24 * 60 * 60 * 1000 - 1)
                        ),
                    };
                }
                return null;
            default:
                return null; // 'all' — no constraint
        }
    };

    // Fetch only the records relevant to the currently selected date window.
    // For 'all' time we still cap at 500 docs to protect the browser; managers
    // can use the date filters or CSV export to access older records.
    const ALL_TIME_LIMIT = 500;

    const fetchAllData = async () => {
        try {
            setLoading(true);

            // Agents collection is small — fetch everything
            const agentsSnapshot = await getDocs(query(collection(db, 'agents')));
            const agentsData = agentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Agent[];
            setAgents(agentsData);

            // Build query constraints for call_analysis
            // IMPORTANT: Firestore requires where() BEFORE orderBy() for range queries.
            const dateRange = buildDateConstraints();
            const callConstraints: QueryConstraint[] = [];
            if (dateRange) {
                callConstraints.push(where('timestamp', '>=', dateRange.start));
                callConstraints.push(where('timestamp', '<=', dateRange.end));
            } else {
                const { limit } = await import('firebase/firestore');
                callConstraints.push(limit(ALL_TIME_LIMIT));
            }
            callConstraints.push(orderBy('timestamp', 'desc'));

            const callsSnapshot = await getDocs(query(collection(db, 'call_analysis'), ...callConstraints));
            const callsData = callsSnapshot.docs.map(doc => {
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
                    language: data.language || 'en',
                    callType: data.callType || { primary: 'Unknown', subCategory: 'N/A', confidence: 0, secondary: [] },
                    type_of_call: data.type_of_call || 'INCOMING',
                    toneAnalysis: {
                        agentMood: data.toneAnalysis?.agentMood || 'N/A',
                        customerMood: data.toneAnalysis?.customerMood || 'N/A',
                        toneMark: data.toneAnalysis?.toneMark || 0,
                        reasoning: data.toneAnalysis?.reasoning || 'No acoustic data available.',
                    },
                } as CallRecord;
            });
            setCalls(callsData);

            // missed_calls documents are keyed as DD-MM-YYYY (e.g. "25-05-2026").
            // We fetch the specific day documents directly by ID instead of using a
            // where() range query — this avoids the DD-MM-YYYY vs YYYY-MM-DD mismatch
            // that caused string comparisons to break.
            const toDDMMYYYY = (d: Date): string => {
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}-${mm}-${yyyy}`;
            };

            // Build the list of DD-MM-YYYY doc IDs to fetch
            const docIdsToFetch: string[] = [];
            if (dateRange) {
                // Walk from start date to end date, one day at a time
                const cursor = new Date(dateRange.start.toDate());
                cursor.setHours(0, 0, 0, 0);
                const endDay = new Date(dateRange.end.toDate());
                endDay.setHours(23, 59, 59, 999);
                while (cursor <= endDay) {
                    docIdsToFetch.push(toDDMMYYYY(cursor));
                    cursor.setDate(cursor.getDate() + 1);
                }
            } else {
                // 'all' — fetch the last 30 days to avoid loading everything
                const today = new Date();
                for (let i = 0; i < 30; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - i);
                    docIdsToFetch.push(toDDMMYYYY(d));
                }
            }

            let allMissedCalls: MissedCall[] = [];
            // Fetch each day doc in parallel using getDoc by known ID
            const { doc: docRef, getDoc } = await import('firebase/firestore');
            const missedSnapshots = await Promise.all(
                docIdsToFetch.map(id => getDoc(docRef(db, 'missed_calls', id)))
            );
            missedSnapshots.forEach(snap => {
                if (!snap.exists()) return;
                const data = snap.data();
                if (data.calls && Array.isArray(data.calls)) {
                    allMissedCalls = [
                        ...allMissedCalls,
                        ...data.calls.map((call: any) => ({ ...call, date: data.date })),
                    ];
                }
            });
            setRawMissedCalls(allMissedCalls);

        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    // --- UTILITIES ---
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
            if (typeof (timestamp as any).toDate === 'function') date = (timestamp as Timestamp).toDate();
            else if (typeof (timestamp as any).seconds === 'number') date = new Date((timestamp as any).seconds * 1000);
            else if (typeof timestamp === 'number') date = new Date(timestamp * 1000);
            else return { date: 'Invalid Date', time: 'Invalid Time' };

            if (!date || isNaN(date.getTime())) return { date: 'N/A', time: 'N/A' };

            return {
                date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
            };
        } catch (error) {
            return { date: 'Error', time: 'Error' };
        }
    };

    const toDate = (ts: any): Date | null => {
        if (!ts) return null;
        try {
            if (typeof ts.toDate === 'function') return ts.toDate();
            if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
        } catch { /* ignore */ }
        return null;
    };
    
    const callsByCallerMap = useMemo(() => {
        const map = new Map<string, CallRecord[]>();
        calls.forEach(call => {
            if (!call.timestamp) return;
            const numbers = call.type_of_call === 'C2C' ? [call.called] : [call.caller];
            numbers.forEach(num => {
                if (!num) return;
                if (!map.has(num)) map.set(num, []);
                map.get(num)!.push(call);
            });
        });
        map.forEach(bucket => bucket.sort((a, b) => {
            const ta = toDate(a.timestamp)?.getTime() ?? 0;
            const tb = toDate(b.timestamp)?.getTime() ?? 0;
            return ta - tb;
        }));
        return map;
    }, [calls]);

    const processedMissedCalls = useMemo(() => {
        return rawMissedCalls.map(missedCall => {
            const customerNumber = missedCall.caller;
            const missedDate = toDate(missedCall.timestamp);
            if (!missedDate) {
                return { ...missedCall, callbackDone: false, resolutionStatus: 'Pending', callbackAgent: '-' } as MissedCall;
            }
            const missedTime = missedDate.getTime();

            const bucket = callsByCallerMap.get(customerNumber) || [];
            const resolutionCall = bucket.find(call => {
                const t = toDate(call.timestamp);
                return t && t.getTime() > missedTime;
            });

            if (resolutionCall) {
                return {
                    ...missedCall,
                    callbackDone: true,
                    resolutionStatus: resolutionCall.type_of_call === 'C2C' ? 'Agent Callback' : 'Attended Later',
                    callbackAgent: resolutionCall.agentName,
                } as MissedCall;
            }
            return {
                ...missedCall,
                callbackDone: false,
                resolutionStatus: 'Pending',
                callbackAgent: '-',
            } as MissedCall;
        });
    }, [rawMissedCalls, callsByCallerMap]);

    // Data already date-filtered by Firestore query — no client-side re-filter needed.
    const statsAnswered = useMemo(() => calls, [calls]);
    const statsMissed = useMemo(() => processedMissedCalls, [processedMissedCalls]);

    const statsFrequent = useMemo(() => {
        // Use a sentinel Timestamp-like object so callerMap entries have a valid initial date.
        const makeSentinelTs = (ts: any) => ts;

        const callerMap = new Map<string, FrequentCaller>();

        statsAnswered.forEach(data => {
            const callerNumber = data.type_of_call === 'C2C' ? data.called : data.caller;
            if (!callerNumber || callerNumber.trim() === '') return;

            if (!callerMap.has(callerNumber)) {
                callerMap.set(callerNumber, {
                    phoneNumber: callerNumber, totalCalls: 0, answeredCalls: 0, missedCalls: 0,
                    lastCallDate: makeSentinelTs(data.timestamp), firstCallDate: makeSentinelTs(data.timestamp),
                    avgScore: 0, topAgents: [], callPurposes: [],
                    sentimentDistribution: { positive: 0, negative: 0, neutral: 0 },
                    averageDuration: 0, callFrequency: 'occasional'
                });
            }
            const caller = callerMap.get(callerNumber)!;
            caller.totalCalls += 1;
            caller.answeredCalls += 1;

            const tsDate = toDate(data.timestamp);
            const lastDate = toDate(caller.lastCallDate);
            const firstDate = toDate(caller.firstCallDate);
            if (tsDate && lastDate && tsDate > lastDate) caller.lastCallDate = data.timestamp;
            if (tsDate && firstDate && tsDate < firstDate) caller.firstCallDate = data.timestamp;

            if (data.overallScore) caller.avgScore = ((caller.avgScore || 0) * (caller.answeredCalls - 1) + data.overallScore) / caller.answeredCalls;

            const agentIndex = caller.topAgents.findIndex(a => a.agentName === data.agentName);
            if (agentIndex >= 0) caller.topAgents[agentIndex].count += 1;
            else caller.topAgents.push({ agentName: data.agentName, count: 1 });

            const purpose = data.callType?.primary || 'Unknown';
            const purposeIndex = caller.callPurposes.findIndex(p => p.purpose === purpose);
            if (purposeIndex >= 0) caller.callPurposes[purposeIndex].count += 1;
            else caller.callPurposes.push({ purpose, count: 1 });

            const sentiment = data.sentiment?.toLowerCase() || 'neutral';
            if (sentiment.includes('positive')) caller.sentimentDistribution.positive += 1;
            else if (sentiment.includes('negative')) caller.sentimentDistribution.negative += 1;
            else caller.sentimentDistribution.neutral += 1;

            caller.averageDuration = ((caller.averageDuration || 0) * (caller.answeredCalls - 1) + (data.duration || 0)) / caller.answeredCalls;
        });

        statsMissed.forEach(call => {
            const callerNumber = call.caller;
            if (!callerNumber || callerNumber.trim() === '') return;
            if (!callerMap.has(callerNumber)) {
                callerMap.set(callerNumber, {
                    phoneNumber: callerNumber, totalCalls: 0, answeredCalls: 0, missedCalls: 0,
                    lastCallDate: makeSentinelTs(call.timestamp), firstCallDate: makeSentinelTs(call.timestamp),
                    avgScore: 0, topAgents: [], callPurposes: [],
                    sentimentDistribution: { positive: 0, negative: 0, neutral: 0 },
                    averageDuration: 0, callFrequency: 'occasional'
                });
            }
            const caller = callerMap.get(callerNumber)!;
            caller.totalCalls += 1;
            caller.missedCalls += 1;

            const tsDate = toDate(call.timestamp);
            const lastDate = toDate(caller.lastCallDate);
            const firstDate = toDate(caller.firstCallDate);
            if (tsDate && lastDate && tsDate > lastDate) caller.lastCallDate = call.timestamp;
            if (tsDate && firstDate && tsDate < firstDate) caller.firstCallDate = call.timestamp;
        });

        let freqArray = Array.from(callerMap.values()).filter(c => c.totalCalls >= minCallsThreshold);
        freqArray.forEach(caller => {
            const lastMs = toDate(caller.lastCallDate)?.getTime() ?? 0;
            const firstMs = toDate(caller.firstCallDate)?.getTime() ?? 0;
            const daysBetween = (lastMs - firstMs) / (1000 * 3600 * 24);
            const callsPerDay = caller.totalCalls / Math.max(daysBetween, 1);
            if (callsPerDay >= 1) caller.callFrequency = 'daily';
            else if (callsPerDay >= 0.14) caller.callFrequency = 'weekly';
            else if (callsPerDay >= 0.033) caller.callFrequency = 'monthly';
            else caller.callFrequency = 'occasional';

            caller.topAgents.sort((a, b) => b.count - a.count);
            caller.callPurposes.sort((a, b) => b.count - a.count);
        });

        return freqArray.sort((a, b) => b.totalCalls - a.totalCalls);
    }, [statsAnswered, statsMissed, minCallsThreshold]);


    // 2. Table Render Arrays (Combines stats arrays + specific View/Dropdown logic)
    const tableAnswered = useMemo(() => {
        let res = [...statsAnswered];
        if (selectedAgent !== 'all') res = res.filter(call => call.agentEmail === selectedAgent);
        if (callTypeFilter !== 'all') res = res.filter(call => call.type_of_call === callTypeFilter);
        
        // Sorting logic
        res.sort((a, b) => {
            let aVal: any, bVal: any;
            switch (sortField) {
                case 'agentName': aVal = a.agentName?.toLowerCase() || ''; bVal = b.agentName?.toLowerCase() || ''; break;
                case 'date': aVal = a.timestamp ? (toDate(a.timestamp)?.getTime() ?? 0) : 0; bVal = b.timestamp ? (toDate(b.timestamp)?.getTime() ?? 0) : 0; break;
                case 'score': aVal = a.overallScore || 0; bVal = b.overallScore || 0; break;
                case 'duration': aVal = a.duration || 0; bVal = b.duration || 0; break;
                default: return 0;
            }
            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
        return res;
    }, [statsAnswered, selectedAgent, callTypeFilter, sortField, sortDirection]);

    const tableMissed = useMemo(() => {
        let res = [...statsMissed];
        if (selectedAgent !== 'all') {
            const agent = agents.find(a => a.email === selectedAgent);
            if (agent) {
                res = res.filter(c => c.called === agent.phone || c.dialed === agent.phone || c.callbackAgent === agent.name);
            }
        }
        if (resolutionFilter !== 'all') res = res.filter(c => c.resolutionStatus === resolutionFilter);
        return res;
    }, [statsMissed, selectedAgent, resolutionFilter, agents]);

    const tableFrequent = useMemo(() => {
        let res = [...statsFrequent];
        if (selectedAgent !== 'all') {
            const agent = agents.find(a => a.email === selectedAgent);
            if (agent) {
                res = res.filter(caller => caller.topAgents.some(a => a.agentName === agent.name));
            }
        }
        return res;
    }, [statsFrequent, selectedAgent, agents]);


    // Generate Top View Aggregated Data specifically using 'Stats' arrays ensuring independent logic
    const { incomingCalls, c2cCalls, uniqueAgentsToday } = useMemo(() => {
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

        const incoming = statsAnswered.filter(call => call.type_of_call === 'INCOMING');
        const c2c = statsAnswered.filter(call => call.type_of_call === 'C2C');
        const uniqueAgents = new Set<string>();

        const todayCalls = calls.filter(call => {
            const d = call.timestamp ? (typeof call.timestamp.toMillis === 'function' ? call.timestamp.toMillis() : (call.timestamp.seconds ? call.timestamp.seconds * 1000 : 0)) : 0;
            if (d >= startOfToday && d < endOfToday) {
                uniqueAgents.add(call.agentId);
                return true;
            }
            return false;
        });

        return {
            incomingCalls: incoming,
            c2cCalls: c2c,
            callsToday: todayCalls,
            uniqueAgentsToday: uniqueAgents.size
        };
    }, [statsAnswered, calls]);

    const frequentCallersStats = useMemo(() => ({
        totalFrequentCallers: statsFrequent.length,
        totalCallsFromFrequent: statsFrequent.reduce((acc, caller) => acc + caller.totalCalls, 0),
        avgCallsPerFrequent: statsFrequent.length > 0
            ? (statsFrequent.reduce((acc, caller) => acc + caller.totalCalls, 0) / statsFrequent.length).toFixed(1)
            : '0.0',
        topCaller: statsFrequent[0]
    }), [statsFrequent]);


    const totalCallsCount = statsAnswered.length;
    const avgScore = totalCallsCount > 0 ? (statsAnswered.reduce((acc, call) => acc + (call.overallScore || 0), 0) / totalCallsCount).toFixed(1) : '0.0';

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const handleDownloadData = () => {
        let dataToExport: any[] = [];
        let headers: string[] = [];
        let filename = '';

        const safeString = (str: any) => `"${(str || '').toString().replace(/"/g, '""')}"`;

        if (callView === 'answered') {
            if (tableAnswered.length === 0) return alert('No data to download.');
            headers = ['Call ID', 'Type', 'Agent', 'Customer', 'System Number', 'Date', 'Time', 'Duration (s)', 'Score', 'Call Type', 'Sentiment'];
            dataToExport = tableAnswered.map(call => {
                const { date, time } = formatDate(call.timestamp);
                const customerNum = call.type_of_call === 'C2C' ? call.called : call.caller;
                const systemNum = call.type_of_call === 'C2C' ? call.caller : (call.dialed || call.called);
                
                return [
                    call.id,
                    call.type_of_call,
                    call.agentName,
                    customerNum,
                    systemNum,
                    date,
                    time,
                    call.duration,
                    call.overallScore,
                    call.callType?.primary || 'Unknown',
                    call.sentiment
                ].map(safeString).join(',');
            });
            filename = `Answered_Calls_${new Date().toISOString().split('T')[0]}.csv`;
            
        } else if (callView === 'missed') {
            if (tableMissed.length === 0) return alert('No data to download.');
            headers = ['Customer Number', 'Called To', 'Date', 'Time', 'Source', 'Status', 'Hangup Reason', 'Agent Type', 'Resolution Status', 'Resolved By Agent'];
            dataToExport = tableMissed.map(call => {
                const { date, time } = formatDate(call.timestamp);
                return [
                    call.caller,
                    call.called,
                    date,
                    time,
                    call.source,
                    call.status,
                    call.hangup_reason,
                    call.agent_type,
                    call.resolutionStatus,
                    call.callbackAgent || 'N/A'
                ].map(safeString).join(',');
            });
            filename = `Missed_Calls_${new Date().toISOString().split('T')[0]}.csv`;
            
        } else if (callView === 'frequent') {
            if (tableFrequent.length === 0) return alert('No data to download.');
            headers = ['Phone Number', 'Total Calls', 'Answered', 'Missed', 'Frequency', 'Avg Score', 'Top Agent'];
            dataToExport = tableFrequent.map(caller => [
                caller.phoneNumber,
                caller.totalCalls,
                caller.answeredCalls,
                caller.missedCalls,
                caller.callFrequency,
                caller.avgScore ? caller.avgScore.toFixed(1) : 'N/A',
                caller.topAgents[0]?.agentName || 'N/A'
            ].map(safeString).join(','));
            filename = `Frequent_Callers_${new Date().toISOString().split('T')[0]}.csv`;
        }

        const csvContent = [headers.join(','), ...dataToExport].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
    const selectedAgentLabel = selectedAgent === 'all' ? 'All Agents' : agents.find(a => a.email === selectedAgent)?.name || 'All Agents';

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
            setDateFilter('custom');
            setShowCalendar(false);
            setShowFilterDropdown(false);
        } else {
            alert('Please select both start and end dates.');
        }
    };

    const getStatusBadgeColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'busy': return 'bg-yellow-100 text-yellow-800';
            case 'noanswer': return 'bg-red-100 text-red-800';
            case 'cancel': return 'bg-orange-100 text-orange-800';
            case 'failed': return 'bg-gray-100 text-gray-800';
            case 'congestion': return 'bg-purple-100 text-purple-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getSourceBadgeColor = (source: string) => {
        switch (source?.toUpperCase()) {
            case 'INCOMING': return 'bg-blue-100 text-blue-800';
            case 'C2C': return 'bg-amber-100 text-amber-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getFrequencyBadgeColor = (frequency: string) => {
        switch (frequency?.toLowerCase()) {
            case 'daily': return 'bg-red-100 text-red-800';
            case 'weekly': return 'bg-orange-100 text-orange-800';
            case 'monthly': return 'bg-blue-100 text-blue-800';
            case 'occasional': return 'bg-gray-100 text-gray-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const totalPages = Math.ceil(
        (callView === 'answered' ? tableAnswered.length : 
         callView === 'missed' ? tableMissed.length : 
         tableFrequent.length) / ITEMS_PER_PAGE
    ) || 1;

    const goToPage = (page: number) => {
        if (page < 1 || page > totalPages) return;
        setCurrentPage(page);
    };

    const currentCalls = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        if (callView === 'answered') {
            return tableAnswered.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        } else if (callView === 'missed') {
            return tableMissed.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        } else {
            return tableFrequent.slice(startIndex, startIndex + ITEMS_PER_PAGE);
        }
    }, [tableAnswered, tableMissed, tableFrequent, currentPage, callView]);


    const prepareScoreData = (call: CallRecord) => {
        if (!call.scores) return [];
        const scoreEntries = Object.entries(call.scores).map(([key, value]) => ({
            subject: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
            A: value || 0,
            fullMark: 10,
        }));
        scoreEntries.push({ subject: 'Tone Mark', A: call.toneAnalysis?.toneMark || 0, fullMark: 10 });
        return scoreEntries;
    };

    const prepareCallSectionData = (call: CallRecord) => {
        if (!call.callSections) return [];
        return Object.entries(call.callSections).map(([key, value]) => ({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            present: value?.present,
            summary: value?.summary || 'No summary available',
        }));
    };

    const prepareCallAnalysisData = (call: CallRecord) => {
        if (!call.callAnalysis) return [];
        return Object.entries(call.callAnalysis).map(([key, value]) => ({
            name: key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            value: value,
        }));
    };
    
    const getChartColors = (isDarkMode: boolean) => ({
        stroke: isDarkMode ? '#e2e8f0' : '#6b7280',
        grid: isDarkMode ? '#475569' : '#e5e7eb',
        tooltipBg: isDarkMode ? '#1f2937' : 'rgba(255, 255, 255, 0.95)',
        tooltipText: isDarkMode ? '#e2e8f0' : '#1f2937'
    });

    const chartColors = getChartColors(isDarkMode);

    const MissedCallCard = ({ call }: { call: MissedCall }) => {
        const { date, time } = formatDate(call.timestamp);
        
        return (
            <div className={`rounded-xl border p-4 mb-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                <div className="flex flex-col space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-red-900 text-red-400' : 'bg-gradient-to-r from-red-500 to-orange-500 text-white'}`}>
                                <PhoneMissed className="w-5 h-5" />
                            </div>
                            <div>
                                <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                    Customer: {call.caller || 'Unknown'}
                                </div>
                                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                    {date} at {time}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold mb-1 inline-block ${getSourceBadgeColor(call.source)}`}>
                                {call.source}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Called To</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{call.called || 'N/A'}</div>
                        </div>
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Agent Type</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{call.agent_type || 'Unknown'}</div>
                        </div>
                        <div className="col-span-2">
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Hangup Reason</div>
                            <div className="flex items-center space-x-2">
                                <span className={`px-2 py-1 rounded-full text-xs ${getStatusBadgeColor(call.status)}`}>
                                    {call.hangup_reason || call.status || 'Unknown'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 dark:border-gray-700">
                        {call.resolutionStatus === 'Agent Callback' ? (
                             <span className="flex items-center font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-md">
                                 <Check className="w-3 h-3 mr-1"/> Callback by {call.callbackAgent}
                             </span>
                        ) : call.resolutionStatus === 'Attended Later' ? (
                             <span className="flex items-center font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md">
                                 <Check className="w-3 h-3 mr-1"/> Attended Later ({call.callbackAgent})
                             </span>
                        ) : (
                             <span className="flex items-center font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-md">
                                 <Clock className="w-3 h-3 mr-1"/> Callback Pending
                             </span>
                        )}
                        <div className={`${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                            {call.network || 'Unknown'}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const FrequentCallerCard = ({ caller }: { caller: FrequentCaller }) => {
        const { date: lastCallDate } = formatDate(caller.lastCallDate);
        const answerRate = caller.totalCalls > 0 
            ? Math.round((caller.answeredCalls / caller.totalCalls) * 100) 
            : 0;
        
        return (
            <div className={`rounded-xl border p-4 mb-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                <div className="flex flex-col space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-purple-900 text-purple-400' : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white'}`}>
                                <UserCheck className="w-5 h-5" />
                            </div>
                            <div>
                                <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                    {caller.phoneNumber}
                                </div>
                                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                    Last called: {lastCallDate}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold mb-1 inline-block ${getFrequencyBadgeColor(caller.callFrequency)}`}>
                                {caller.callFrequency.toUpperCase()}
                            </span>
                            <div className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                {caller.totalCalls} calls
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Answered</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{caller.answeredCalls} ({answerRate}%)</div>
                        </div>
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Missed</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{caller.missedCalls}</div>
                        </div>
                        {caller.avgScore && (
                            <div>
                                <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Avg Score</div>
                                <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{caller.avgScore.toFixed(1)}/10</div>
                            </div>
                        )}
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Avg Duration</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{formatDuration(caller.averageDuration)}</div>
                        </div>
                    </div>

                    <div>
                        <div className={`font-medium mb-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Sentiment</div>
                        <div className="flex items-center space-x-2">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-l-full" style={{ width: `${(caller.sentimentDistribution.positive / caller.answeredCalls) * 100 || 0}%` }}></div>
                                <div className="bg-yellow-500 h-2" style={{ width: `${(caller.sentimentDistribution.neutral / caller.answeredCalls) * 100 || 0}%` }}></div>
                                <div className="bg-red-500 h-2 rounded-r-full" style={{ width: `${(caller.sentimentDistribution.negative / caller.answeredCalls) * 100 || 0}%` }}></div>
                            </div>
                            <div className="text-xs">
                                <span className="text-green-600 dark:text-green-400">{caller.sentimentDistribution.positive}✓</span>
                                {' '}
                                <span className="text-yellow-600 dark:text-yellow-400">{caller.sentimentDistribution.neutral}~</span>
                                {' '}
                                <span className="text-red-600 dark:text-red-400">{caller.sentimentDistribution.negative}✗</span>
                            </div>
                        </div>
                    </div>

                    {caller.topAgents.length > 0 && (
                        <div>
                            <div className={`font-medium mb-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                                Top Agent: {caller.topAgents[0].agentName} ({caller.topAgents[0].count} calls)
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const CallCard = ({ call }: { call: CallRecord }) => {
        const { date, time } = formatDate(call.timestamp);
        const callTypeColor = call.type_of_call === 'C2C'
            ? (isDarkMode ? 'border-amber-500/50 bg-amber-900/20' : 'border-amber-300 bg-amber-50')
            : (isDarkMode ? 'border-indigo-500/50 bg-indigo-900/20' : 'border-indigo-300 bg-indigo-50');
        
        const customerNum = call.type_of_call === 'C2C' ? call.called : call.caller;
        const systemNum = call.type_of_call === 'C2C' ? call.caller : (call.dialed || call.called);
        
        return (
            <div className={`rounded-xl border p-4 mb-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'} ${callTypeColor}`}>
                <div className="flex flex-col space-y-3">
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
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold mb-1 inline-block ${
                                call.type_of_call === 'C2C' ? 'bg-amber-500/70 text-amber-900' : 'bg-indigo-500/70 text-indigo-900'
                            }`}>
                                {call.type_of_call === 'C2C' ? 'OUTGOING (C2C)' : 'INCOMING'}
                            </span>
                            <div className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                {call.overallScore || 0}/10
                            </div>
                            <div className="w-12 h-1 rounded-full bg-slate-200 mt-1">
                                <div className="bg-gradient-to-r from-emerald-400 to-sky-500 h-1 rounded-full" style={{ width: `${(call.overallScore || 0) * 10}%` }}></div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Customer / System</div>
                            <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{customerNum || 'N/A'}</div>
                            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>to {systemNum || 'N/A'}</div>
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

                    <div className="flex space-x-2 pt-2">
                        {call.recordingUrl ? (
                            <button
                                onClick={() => playAudio(call.id, call.recordingUrl)}
                                className={`flex-1 flex items-center justify-center px-3 py-2 rounded-lg transition-colors text-xs font-medium ${
                                    audioPlaying === call.id ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                }`}
                            >
                                {audioPlaying === call.id ? (<><Pause className="w-3 h-3 mr-1" /> Pause</>) : (<><Play className="w-3 h-3 mr-1" /> Play</>)}
                            </button>
                        ) : (
                            <button disabled className="flex-1 flex items-center justify-center px-3 py-2 bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed text-xs font-medium">
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

    if (loading) {
        return (
            <div className={`min-h-screen p-6 flex items-center justify-center ${isDarkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100'}`}>
                <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
            </div>
        );
    }

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
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 pb-4 border-b border-slate-200">
                <div className="mb-4 sm:mb-0">
                    <h2 className={`text-2xl sm:text-3xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>Call Analysis: {selectedCall.agentName}</h2>
                    <p className={`mt-1 text-sm sm:text-base ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                    Call on <span className="font-semibold">{date}</span> at <span className="font-semibold">{time}</span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-start sm:justify-start space-x-2 sm:space-x-4 w-full sm:w-auto">
                
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
            
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6 mb-6 sm:mb-8">
                <StatCard title="Overall Score" value={`${selectedCall.overallScore || 0}/10`} icon={<Award className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />} bgColor="bg-purple-100" trend="up" isDarkMode={isDarkMode} />
                <StatCard title="Tone Mark (Acoustic)" value={`${selectedCall.toneAnalysis?.toneMark || 0}/10`} icon={<Mic className="w-5 h-5 sm:w-6 sm:h-6 text-pink-600" />} bgColor="bg-pink-100" isDarkMode={isDarkMode} />
                <StatCard title="Duration" value={formatDuration(selectedCall.duration)} icon={<Clock className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />} bgColor="bg-blue-100" isDarkMode={isDarkMode} />
                <StatCard title="Sentiment" value={selectedCall.sentiment?.charAt(0).toUpperCase() + selectedCall.sentiment?.slice(1) || 'Neutral'} icon={<Heart className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />} bgColor="bg-green-100" sentiment={selectedCall.sentiment} isDarkMode={isDarkMode} />
                <StatCard title="Filler Words" value={selectedCall.fillerWords?.toString() || '0'} icon={<MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />} bgColor="bg-orange-100" isDarkMode={isDarkMode} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 mb-8 sm:mb-10">
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
                        <Tooltip contentStyle={{ backgroundColor: chartColors.tooltipBg, border: 'none', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', backdropFilter: 'blur(8px)', color: chartColors.tooltipText }} />
                        </RadarChart>
                    </ResponsiveContainer>
                    </div>
                </div>

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
                        <AlertCircle className="w-4 h-4 mr-1 text-red-500" />
                        Tone Reasoning
                        </h4>
                        <p className={`text-xs sm:text-sm leading-relaxed p-3 sm:p-4 rounded-lg border shadow-sm ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-slate-200 text-slate-700'}`}>
                        {selectedCall.toneAnalysis?.reasoning || 'LLM analysis summary not available.'}
                        </p>
                    </div>
                    </div>
                </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 mb-6 sm:mb-8">
                <div className={`lg:col-span-2 rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                    <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                    <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-600" />
                    Call Sections Breakdown
                    </h3>
                    <div className="space-y-4">
                    {callSectionData.map((section, index) => (
                        <div key={index} className={`p-3 sm:p-4 rounded-lg border-l-4 transition-all duration-300 hover:shadow-md ${isDarkMode ? (section.present ? 'bg-green-900/30' : 'bg-red-900/30') : (section.present ? 'bg-green-50' : 'bg-red-50')}`}
                        style={{ borderLeftColor: section.present ? '#10B981' : '#EF4444' }}>
                        <div className="flex items-center justify-between mb-2">
                            <h4 className={`text-sm sm:text-base font-semibold ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>{section.name} Section</h4>
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${section.present ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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

                <div className={`rounded-2xl p-4 sm:p-6 shadow-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                    <h3 className={`text-lg sm:text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                    <Shield className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-green-600" />
                    Call Quality Metrics
                    </h3>
                    <div className="space-y-3 sm:space-y-4">
                    {callAnalysisData.map((item, index) => (
                        <div key={index} className={`flex items-center justify-between p-2 sm:p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-slate-50'}`}>
                        <span className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>{item.name}</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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
            <div className="mb-6 sm:mb-8">
                <div className={`rounded-3xl shadow-2xl border p-4 sm:p-8 relative overflow-visible ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                    <div className={`absolute top-0 right-0 w-32 h-32 sm:w-48 sm:h-48 rounded-bl-full opacity-60 transform translate-x-1/4 -translate-y-1/4 ${isDarkMode ? 'bg-gradient-to-tr from-indigo-800 to-purple-800' : 'bg-gradient-to-tr from-indigo-200 to-purple-200'}`}></div>
                    <div className="relative z-10">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center space-x-3 sm:space-x-4">
                                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-3 sm:p-4 rounded-full shadow-lg">
                                    <Phone className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                                </div>
                                <div>
                                    <h1 className={`text-2xl sm:text-3xl font-extrabold mb-1 ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>Call History</h1>
                                    <p className={`text-sm sm:text-base ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Monitor and analyze your team's call performance</p>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mt-4 sm:mt-0">
                                {/* Call View Radio Buttons */}
                                <div className="flex items-center space-x-2 bg-slate-100 dark:bg-gray-700 rounded-xl p-1">
                                    <button
                                        onClick={() => setCallView('answered')}
                                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium ${
                                            callView === 'answered'
                                                ? 'bg-white dark:bg-gray-800 shadow-sm text-indigo-600 dark:text-indigo-400'
                                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-300'
                                        }`}
                                    >
                                        <Phone className="w-4 h-4" />
                                        <span className="hidden sm:inline">Answered</span>
                                    </button>
                                    <button
                                        onClick={() => setCallView('missed')}
                                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium ${
                                            callView === 'missed'
                                                ? 'bg-white dark:bg-gray-800 shadow-sm text-red-600 dark:text-red-400'
                                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-300'
                                        }`}
                                    >
                                        <PhoneMissed className="w-4 h-4" />
                                        <span className="hidden sm:inline">Missed</span>
                                    </button>
                                    <button
                                        onClick={() => setCallView('frequent')}
                                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium ${
                                            callView === 'frequent'
                                                ? 'bg-white dark:bg-gray-800 shadow-sm text-purple-600 dark:text-purple-400'
                                                : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-300'
                                        }`}
                                    >
                                        <UserCheck className="w-4 h-4" />
                                        <span className="hidden sm:inline">Frequent</span>
                                    </button>
                                </div>

                                {/* Call Type Filter - Only show for Answered view */}
                                {callView === 'answered' && (
                                    <div className="relative z-20 w-full sm:w-auto" ref={callTypeDropdownRef}>
                                        <button
                                            onClick={() => setShowCallTypeDropdown(!showCallTypeDropdown)}
                                            className={`flex items-center justify-between space-x-2 px-4 sm:px-6 py-2 sm:py-3 border rounded-xl shadow-sm transition-all duration-200 font-medium hover:shadow-md w-full ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                                        >
                                            <div className="flex items-center space-x-2">
                                                <Phone className={`w-4 h-4 sm:w-5 sm:h-5 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-500'}`} />
                                                <span className="text-sm sm:text-base">
                                                    {callTypeFilter === 'all' ? 'All Calls' : callTypeFilter === 'INCOMING' ? 'Incoming' : 'Outgoing (C2C)'}
                                                </span>
                                            </div>
                                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showCallTypeDropdown ? 'transform rotate-180' : ''}`} />
                                        </button>
                                        {showCallTypeDropdown && (
                                            <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl shadow-lg z-20 overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                                <button
                                                    onClick={() => { setCallTypeFilter('all'); setShowCallTypeDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${callTypeFilter === 'all' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-slate-500 mr-3`}></span>
                                                    All Calls
                                                </button>
                                                <button
                                                    onClick={() => { setCallTypeFilter('INCOMING'); setShowCallTypeDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${callTypeFilter === 'INCOMING' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-blue-500 mr-3`}></span>
                                                    Incoming
                                                </button>
                                                <button
                                                    onClick={() => { setCallTypeFilter('C2C'); setShowCallTypeDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${callTypeFilter === 'C2C' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-amber-500 mr-3`}></span>
                                                    Outgoing (C2C)
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Resolution Status Filter - Only show for Missed view */}
                                {callView === 'missed' && (
                                    <div className="relative z-20 w-full sm:w-auto" ref={resolutionDropdownRef}>
                                        <button
                                            onClick={() => setShowResolutionDropdown(!showResolutionDropdown)}
                                            className={`flex items-center justify-between space-x-2 px-4 sm:px-6 py-2 sm:py-3 border rounded-xl shadow-sm transition-all duration-200 font-medium hover:shadow-md w-full ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                                        >
                                            <div className="flex items-center space-x-2">
                                                <Filter className={`w-4 h-4 sm:w-5 sm:h-5 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`} />
                                                <span className="text-sm sm:text-base">
                                                    {resolutionFilter === 'all' ? 'All Status' : resolutionFilter}
                                                </span>
                                            </div>
                                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showResolutionDropdown ? 'transform rotate-180' : ''}`} />
                                        </button>
                                        {showResolutionDropdown && (
                                            <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl shadow-lg z-20 overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                                <button
                                                    onClick={() => { setResolutionFilter('all'); setShowResolutionDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${resolutionFilter === 'all' ? 'bg-red-50 text-red-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-slate-500 mr-3`}></span>
                                                    All Status
                                                </button>
                                                <button
                                                    onClick={() => { setResolutionFilter('Agent Callback'); setShowResolutionDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${resolutionFilter === 'Agent Callback' ? 'bg-red-50 text-red-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-emerald-500 mr-3`}></span>
                                                    Agent Callback
                                                </button>
                                                <button
                                                    onClick={() => { setResolutionFilter('Attended Later'); setShowResolutionDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${resolutionFilter === 'Attended Later' ? 'bg-red-50 text-red-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-blue-500 mr-3`}></span>
                                                    Attended Later
                                                </button>
                                                <button
                                                    onClick={() => { setResolutionFilter('Pending'); setShowResolutionDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${resolutionFilter === 'Pending' ? 'bg-red-50 text-red-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full bg-amber-500 mr-3`}></span>
                                                    Pending
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Agent Filter - Applies globally now */}
                                <div className="relative z-20 w-full sm:w-auto" ref={agentDropdownRef}>
                                    <button
                                        onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                                        className={`flex items-center justify-between space-x-2 px-4 sm:px-6 py-2 sm:py-3 border rounded-xl shadow-sm transition-all duration-200 font-medium hover:shadow-md w-full ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <Users className={`w-4 h-4 sm:w-5 sm:h-5 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-500'}`} />
                                            <span className="text-sm sm:text-base">{selectedAgentLabel}</span>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showAgentDropdown ? 'transform rotate-180' : ''}`} />
                                    </button>
                                    {showAgentDropdown && (
                                        <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl shadow-lg z-20 overflow-y-auto max-h-64 border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                            <button
                                                onClick={() => { setSelectedAgent('all'); setShowAgentDropdown(false); }}
                                                className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${selectedAgent === 'all' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                                            >
                                                <span className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-gray-500' : 'bg-slate-500'} mr-3`}></span>
                                                All Agents
                                            </button>
                                            {agents.map(agent => (
                                                <button
                                                    key={agent.id}
                                                    onClick={() => { setSelectedAgent(agent.email); setShowAgentDropdown(false); }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${selectedAgent === agent.email ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className="w-2 h-2 rounded-full bg-indigo-500 mr-3"></span>
                                                    {agent.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Date Filter */}
                                <div className="relative z-20 w-full sm:w-auto" ref={filterDropdownRef}>
                                    <button
                                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                        className={`flex items-center justify-between space-x-2 px-4 sm:px-6 py-2 sm:py-3 border rounded-xl shadow-sm transition-all duration-200 font-medium hover:shadow-md w-full ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}`}
                                    >
                                        <div className="flex items-center space-x-2">
                                            <Filter className={`w-4 h-4 sm:w-5 sm:h-5 ${isDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
                                            <span className="text-sm sm:text-base">{selectedFilterLabel}</span>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilterDropdown ? 'transform rotate-180' : ''}`} />
                                    </button>
                                    {showFilterDropdown && (
                                        <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl shadow-lg z-20 overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                                            {dateFilterOptions.map(option => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => {
                                                        if (option.value === 'custom') {
                                                            setShowCalendar(true);
                                                        } else {
                                                            setDateFilter(option.value as DateFilter);
                                                            setShowFilterDropdown(false);
                                                        }
                                                    }}
                                                    className={`w-full text-left px-4 py-3 transition-colors duration-200 flex items-center ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'} ${dateFilter === option.value ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700'}`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full ${option.color} mr-3`}></span>
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Export Data Button */}
                                <button
                                    onClick={handleDownloadData}
                                    className={`flex items-center justify-center p-2 sm:p-3 border rounded-xl shadow-sm transition-all duration-200 hover:shadow-md ${
                                        isDarkMode 
                                            ? 'bg-gray-700 border-gray-600 text-gray-300 hover:text-white hover:border-gray-500' 
                                            : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400'
                                    }`}
                                    title="Export View to CSV"
                                >
                                    <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Custom Calendar Modal */}
            {showCalendar && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" 
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowCalendar(false);
                            setShowFilterDropdown(false);
                        }
                    }}
                >
                    <div
                        ref={calendarModalRef}
                        className={`rounded-xl p-6 w-full max-w-md shadow-2xl border ${isDarkMode ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-white border-slate-200'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-semibold mb-4">Select Custom Date Range</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Start Date</label>
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        placeholder="DD-MM-YYYY"
                                        defaultValue={customStartDate ? `${customStartDate.split('-')[2]}-${customStartDate.split('-')[1]}-${customStartDate.split('-')[0]}` : ''}
                                        key={`start-${customStartDate}`}
                                        onBlur={(e) => {
                                            const match = e.target.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                                            if (match) {
                                                const [_, day, month, year] = match;
                                                const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                if (!isNaN(parsed.getTime())) {
                                                    if (parsed > new Date()) {
                                                        e.target.value = customStartDate ? `${customStartDate.split('-')[2]}-${customStartDate.split('-')[1]}-${customStartDate.split('-')[0]}` : '';
                                                    } else {
                                                        setCustomStartDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
                                                    }
                                                }
                                            } else {
                                                e.target.value = customStartDate ? `${customStartDate.split('-')[2]}-${customStartDate.split('-')[1]}-${customStartDate.split('-')[0]}` : '';
                                            }
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        className={`w-full p-2 pr-10 border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                    />
                                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 overflow-hidden cursor-pointer">
                                        <Calendar size={20} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                        <input
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={customStartDate}
                                            onChange={(e) => {
                                                if (e.target.value && new Date(e.target.value) <= new Date()) {
                                                    setCustomStartDate(e.target.value);
                                                }
                                            }}
                                            className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>End Date</label>
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        placeholder="DD-MM-YYYY"
                                        defaultValue={customEndDate ? `${customEndDate.split('-')[2]}-${customEndDate.split('-')[1]}-${customEndDate.split('-')[0]}` : ''}
                                        key={`end-${customEndDate}`}
                                        onBlur={(e) => {
                                            const match = e.target.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                                            if (match) {
                                                const [_, day, month, year] = match;
                                                const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                if (!isNaN(parsed.getTime())) {
                                                    if (parsed > new Date()) {
                                                        e.target.value = customEndDate ? `${customEndDate.split('-')[2]}-${customEndDate.split('-')[1]}-${customEndDate.split('-')[0]}` : '';
                                                    } else {
                                                        setCustomEndDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
                                                    }
                                                }
                                            } else {
                                                e.target.value = customEndDate ? `${customEndDate.split('-')[2]}-${customEndDate.split('-')[1]}-${customEndDate.split('-')[0]}` : '';
                                            }
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        className={`w-full p-2 pr-10 border rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                    />
                                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 overflow-hidden cursor-pointer">
                                        <Calendar size={20} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                        <input
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={customEndDate}
                                            onChange={(e) => {
                                                if (e.target.value && new Date(e.target.value) <= new Date()) {
                                                    setCustomEndDate(e.target.value);
                                                }
                                            }}
                                            className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end space-x-3 pt-4">
                                <button
                                    onClick={() => { setShowCalendar(false); setShowFilterDropdown(false); }}
                                    className={`px-4 py-2 rounded-md transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'}`}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCustomDateApply}
                                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 shadow-md transition-colors"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Cards - Derived solely from Date Filter Arrays */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6 mb-6 sm:mb-8">
                {callView === 'answered' ? (
                    <>
                        <StatCard title="Total Calls" value={totalCallsCount} icon={<Phone className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />} bgColor="bg-indigo-100" isDarkMode={isDarkMode} />
                        <StatCard title="Incoming Calls" value={incomingCalls.length} icon={<ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 rotate-135 text-blue-600" />} bgColor="bg-blue-100" isDarkMode={isDarkMode} />
                        <StatCard title="Outgoing (C2C)" value={c2cCalls.length} icon={<ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 rotate-45 text-amber-600" />} bgColor="bg-amber-100" isDarkMode={isDarkMode} />
                        <StatCard title="Avg. Score" value={avgScore} icon={<TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-rose-600" />} bgColor="bg-rose-100" isDarkMode={isDarkMode} />
                        <StatCard title="Agents Today" value={`${uniqueAgentsToday}/${agents.length}`} icon={<Users className="w-5 h-5 sm:w-6 sm:h-6 text-fuchsia-600" />} bgColor="bg-fuchsia-100" isDarkMode={isDarkMode} />
                    </>
                ) : callView === 'missed' ? (
                    <>
                        <StatCard title="Total Missed" value={statsMissed.length} icon={<PhoneMissed className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />} bgColor="bg-red-100" isDarkMode={isDarkMode} />
                        <StatCard title="Incoming Missed" value={statsMissed.filter(call => call.source === 'INCOMING').length} icon={<PhoneOff className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />} bgColor="bg-blue-100" isDarkMode={isDarkMode} />
                        <StatCard title="C2C Missed" value={statsMissed.filter(call => call.source === 'C2C').length} icon={<PhoneOff className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" />} bgColor="bg-amber-100" isDarkMode={isDarkMode} />
                        <StatCard title="No Answer" value={statsMissed.filter(call => call.status === 'NOANSWER').length} icon={<X className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />} bgColor="bg-red-100" isDarkMode={isDarkMode} />
                        <StatCard title="Busy" value={statsMissed.filter(call => call.status === 'BUSY').length} icon={<Phone className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />} bgColor="bg-yellow-100" isDarkMode={isDarkMode} />
                    </>
                ) : (
                    <>
                        {/* Frequent Callers Stats */}
                        <StatCard title="Frequent Callers" value={frequentCallersStats?.totalFrequentCallers || 0} icon={<UserCheck className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />} bgColor="bg-purple-100" isDarkMode={isDarkMode} />
                        <StatCard title="Total Calls" value={frequentCallersStats?.totalCallsFromFrequent || 0} icon={<Hash className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />} bgColor="bg-indigo-100" isDarkMode={isDarkMode} />
                        <StatCard title="Avg Calls/Caller" value={frequentCallersStats?.avgCallsPerFrequent || '0.0'} icon={<Activity className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />} bgColor="bg-green-100" isDarkMode={isDarkMode} />
                        <StatCard title="Top Caller" value={frequentCallersStats?.topCaller?.totalCalls || 0} icon={<Zap className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />} bgColor="bg-yellow-100" isDarkMode={isDarkMode} />
                        {/* Threshold Control */}
                        <div className={`rounded-2xl shadow-xl border p-6 hover:shadow-lg transition-shadow duration-300 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Min Calls</p>
                                    <div className="flex items-center space-x-2 mt-1">
                                        <input type="range" min="2" max="10" value={minCallsThreshold} onChange={(e) => setMinCallsThreshold(parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                                        <span className={`text-xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>{minCallsThreshold}+</span>
                                    </div>
                                </div>
                                <div className="bg-purple-100 p-3 rounded-full">
                                    <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Calls Display - Mobile Cards / Desktop Table */}
            <div className={`rounded-2xl shadow-xl overflow-hidden border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-slate-200'}`}>
                <div className={`px-4 sm:px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-slate-200'}`}>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                            {callView === 'answered' ? 'Answered Call Records' : 
                             callView === 'missed' ? 'Missed Call Records' : 
                             `Frequent Callers (${minCallsThreshold}+ calls)`}
                        </h3>
                        {callView === 'answered' && (
                            <div className="flex flex-wrap items-center space-x-2">
                                <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>Sort by:</span>
                                <div className={`flex rounded-lg p-1 ${isDarkMode ? 'bg-gray-700' : 'bg-slate-100'}`}>
                                    <button onClick={() => handleSort('agentName')} className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'agentName' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>
                                        Agent
                                        {sortField === 'agentName' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                    <button onClick={() => handleSort('date')} className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'date' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>
                                        Date
                                        {sortField === 'date' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                    <button onClick={() => handleSort('score')} className={`flex items-center px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${sortField === 'score' ? (isDarkMode ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}>
                                        Score
                                        {sortField === 'score' && (sortDirection === 'asc' ? <SortAsc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" /> : <SortDesc className="w-3 h-3 sm:w-4 sm:h-4 ml-1" />)}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Mobile View - Cards */}
                <div className="block sm:hidden p-4">
                    {callView === 'answered' ? (
                        currentCalls.length === 0 ? (
                            <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                <Phone className={`w-12 h-12 mx-auto mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No calls found</p>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters</p>
                            </div>
                        ) : (
                            currentCalls.map((call) => (
                                <CallCard key={(call as CallRecord).id} call={call as CallRecord} />
                            ))
                        )
                    ) : callView === 'missed' ? (
                        currentCalls.length === 0 ? (
                            <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                <PhoneMissed className={`w-12 h-12 mx-auto mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No missed calls found</p>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters</p>
                            </div>
                        ) : (
                            currentCalls.map((call) => (
                                <MissedCallCard key={(call as MissedCall).call_id ?? Math.random()} call={call as MissedCall} />
                            ))
                        )
                    ) : (
                        currentCalls.length === 0 ? (
                            <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                <UserCheck className={`w-12 h-12 mx-auto mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No frequent callers found</p>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try lowering the minimum calls threshold</p>
                            </div>
                        ) : (
                            currentCalls.map((caller) => (
                                <FrequentCallerCard key={(caller as FrequentCaller).phoneNumber} caller={caller as FrequentCaller} />
                            ))
                        )
                    )}
                </div>

                {/* Desktop View - Table */}
                <div className="hidden sm:block overflow-x-auto">
                    <table className="min-w-full table-auto">
                        <thead className={`border-b ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-slate-50 border-slate-200'}`}>
                            <tr>
                                {callView === 'answered' ? (
                                    <>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Type</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Agent</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Customer / System #</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Date & Time</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Call Type</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Duration</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Score</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Actions</th>
                                    </>
                                ) : callView === 'missed' ? (
                                    <>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Customer No.</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>System No.</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Date & Time</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Source</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Status</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Hangup Reason</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Resolution</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Resolved By</th>
                                    </>
                                ) : (
                                    <>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Phone Number</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Total Calls</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Answered/Missed</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Frequency</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Last Call</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Avg Score</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Avg Duration</th>
                                        <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Top Agent</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-white divide-slate-200'}`}>
                            {callView === 'answered' ? (
                                currentCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className={`px-6 py-8 text-center ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                            <div className="flex flex-col items-center justify-center">
                                                <Phone className={`w-12 h-12 mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No calls found</p>
                                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters to see more results</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    currentCalls.map((call) => {
                                        const callRecord = call as CallRecord;
                                        const { date, time } = formatDate(callRecord.timestamp);
                                        const isC2C = callRecord.type_of_call === 'C2C';
                                        
                                        const customerNum = isC2C ? callRecord.called : callRecord.caller;
                                        const systemNum = isC2C ? callRecord.caller : (callRecord.dialed || callRecord.called);
                                        
                                        return (
                                            <tr
                                                key={callRecord.id}
                                                className={`transition-all duration-150 ${isC2C
                                                    ? (isDarkMode ? 'bg-amber-900/10 hover:bg-amber-900/30' : 'hover:bg-amber-50')
                                                    : (isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50')
                                                }`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                                        isC2C ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                                                    }`}>
                                                        {isC2C ? 'C2C' : 'INCOMING'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center">
                                                        <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-indigo-900 text-indigo-400' : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white'}`}>
                                                            <span className="text-sm font-medium">{callRecord.agentName?.charAt(0) || 'A'}</span>
                                                        </div>
                                                        <div className="ml-4">
                                                            <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{callRecord.agentName || 'Unknown Agent'}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{customerNum || 'N/A'}</div>
                                                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>to {systemNum || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{date}</div>
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{time}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>
                                                        {callRecord.callType?.primary || 'Unknown'}
                                                    </div>
                                                </td>
                                                <td className={`px-6 py-4 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                    {formatDuration(callRecord.duration)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex flex-col items-start">
                                                        <div className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{callRecord.overallScore || 0}/10</div>
                                                        <div className={`w-16 h-2 rounded-full ${isDarkMode ? 'bg-gray-600' : 'bg-slate-200'}`}>
                                                            <div className="bg-gradient-to-r from-emerald-400 to-sky-500 h-2 rounded-full" style={{ width: `${(callRecord.overallScore || 0) * 10}%` }}></div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <div className="flex items-center space-x-2">
                                                        {callRecord.recordingUrl ? (
                                                            <button
                                                                onClick={() => playAudio(callRecord.id, callRecord.recordingUrl)}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg transition-colors text-xs ${audioPlaying === callRecord.id ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                                                                title='Play recording'
                                                            >
                                                                {audioPlaying === callRecord.id ? (<><Pause className="w-3 h-3 mr-1" /> Pause</>) : (<><Play className="w-3 h-3 mr-1" /> Play</>)}
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
                                                            onClick={() => handleViewAnalytics(callRecord)}
                                                            className="flex items-center px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-xs"
                                                        >
                                                            <BarChart3 className="w-3 h-3 mr-1" /> Analyze
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )
                            ) : callView === 'missed' ? (
                                currentCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className={`px-6 py-8 text-center ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                            <div className="flex flex-col items-center justify-center">
                                                <PhoneMissed className={`w-12 h-12 mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No missed calls found</p>
                                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try adjusting your filters to see more results</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    currentCalls.map((call) => {
                                        const missedCall = call as MissedCall;
                                        const { date, time } = formatDate(missedCall.timestamp);
                                        return (
                                            <tr
                                                key={missedCall.call_id}
                                                className={`transition-all duration-150 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'}`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{missedCall.caller || 'Unknown'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{missedCall.called || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{date}</div>
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{time}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getSourceBadgeColor(missedCall.source)}`}>
                                                        {missedCall.source}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(missedCall.status)}`}>
                                                        {missedCall.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{missedCall.hangup_reason || 'Unknown'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {missedCall.resolutionStatus === 'Agent Callback' ? (
                                                        <span className="flex items-center text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                                                            <Check className="w-4 h-4 mr-1" /> Agent Callback
                                                        </span>
                                                    ) : missedCall.resolutionStatus === 'Attended Later' ? (
                                                        <span className="flex items-center text-blue-600 dark:text-blue-400 text-sm font-medium">
                                                            <Check className="w-4 h-4 mr-1" /> Attended Later
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center text-amber-500 dark:text-amber-500 text-sm font-medium">
                                                            <Clock className="w-4 h-4 mr-1" /> Pending
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                        {missedCall.callbackAgent || '-'}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )
                            ) : (
                                currentCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className={`px-6 py-8 text-center ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>
                                            <div className="flex flex-col items-center justify-center">
                                                <UserCheck className={`w-12 h-12 mb-2 ${isDarkMode ? 'text-gray-700' : 'text-slate-300'}`} />
                                                <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-900'}`}>No frequent callers found</p>
                                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-500'}`}>Try lowering the minimum calls threshold</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    currentCalls.map((caller) => {
                                        const frequentCaller = caller as FrequentCaller;
                                        const { date: lastCallDate } = formatDate(frequentCaller.lastCallDate);
                                        const answerRate = frequentCaller.totalCalls > 0 
                                            ? Math.round((frequentCaller.answeredCalls / frequentCaller.totalCalls) * 100) 
                                            : 0;
                                        
                                        return (
                                            <tr
                                                key={frequentCaller.phoneNumber}
                                                className={`transition-all duration-150 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-slate-50'}`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                        {frequentCaller.phoneNumber}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-2xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                                                        {frequentCaller.totalCalls}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="text-sm">
                                                        <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                            ✓ {frequentCaller.answeredCalls}
                                                        </div>
                                                        <div className={`${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                                            ✗ {frequentCaller.missedCalls} ({100 - answerRate}%)
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getFrequencyBadgeColor(frequentCaller.callFrequency)}`}>
                                                        {frequentCaller.callFrequency}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>{lastCallDate}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                        {frequentCaller.avgScore ? `${frequentCaller.avgScore.toFixed(1)}/10` : 'N/A'}
                                                    </div>
                                                </td>
                                                <td className={`px-6 py-4 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                    {formatDuration(frequentCaller.averageDuration)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="text-sm">
                                                        <div className={`${isDarkMode ? 'text-gray-200' : 'text-slate-900'}`}>
                                                            {frequentCaller.topAgents[0]?.agentName || 'N/A'}
                                                        </div>
                                                        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                                                            ({frequentCaller.topAgents[0]?.count || 0} calls)
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {(
                    (callView === 'answered' && tableAnswered.length > 0) ||
                    (callView === 'missed' && tableMissed.length > 0) ||
                    (callView === 'frequent' && tableFrequent.length > 0)
                ) && (
                    <div className={`px-4 sm:px-6 py-4 border-t flex flex-col md:flex-row items-center justify-between gap-4 ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-slate-50 border-slate-200'}`}>
                        <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, (
                                callView === 'answered' ? tableAnswered.length : 
                                callView === 'missed' ? tableMissed.length : 
                                tableFrequent.length
                            ))} of {callView === 'answered' ? tableAnswered.length : 
                                     callView === 'missed' ? tableMissed.length : 
                                     tableFrequent.length} {callView === 'frequent' ? 'callers' : 'calls'}
                        </span>
                        <div className="flex space-x-1">
                            <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1}
                                className={`px-3 py-1 rounded-md text-sm font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-white border-slate-300 text-slate-700'}`}
                            >
                                Previous
                            </button>
                            {[...Array(totalPages)].map((_, index) => {
                                // Simple pagination limiter logic so we don't render 100 buttons
                                if (totalPages > 7 && (index < currentPage - 3 || index > currentPage + 1) && index !== 0 && index !== totalPages - 1) {
                                    if (index === 1 || index === totalPages - 2) return <span key={index} className="px-2">...</span>;
                                    return null;
                                }
                                return (
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
                            )})}
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
