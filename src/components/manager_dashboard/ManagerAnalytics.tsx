import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { format, eachDayOfInterval, parseISO, subMonths, endOfDay, startOfDay, getHours } from 'date-fns';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, RadarChart, PolarGrid,
    PolarAngleAxis, PolarRadiusAxis, Radar, LineChart, Line
} from 'recharts';
import {
    Users, TrendingUp, Target, Award, Clock, Phone, Activity, Calendar,
    Shield, ThumbsUp, Sparkles, Zap, BarChart3,
    PieChart as PieChartIcon, Download, RefreshCw, Star, TrendingDown, Mic
} from 'lucide-react';

import { User } from "../../types";

interface ManagerAnalyticsProps {
    user: User;
    isDarkMode: boolean;
}

interface Agent {
    id: string;
    name: string;
    email: string;
    phone: string;
    stats: {
        totalCalls: number;
        overallScore: number;
        lastCallDate: any;
        updatedAt: any;
    };
}

interface ToneAnalysis {
    agentMood: string;
    customerMood: string;
    toneMark: number;
    reasoning: string;
}

interface CallAnalysis {
    callId: string;
    agentId: string;
    agentName: string;
    agentEmail: string;
    timestamp: any;
    duration: number;
    overallScore: number;
    sentiment: string;
    language: string;
    talkRatio: string;
    objections: string[];
    coachingTips: string[];
    scores: {
        structure: number;
        clarity: number;
        confidence: number;
        closing: number;
        intro: number;
        upselling: number;
        sympathy: number;
        end_call: number;
        call_summary: number;
    };
    callAnalysis: {
        company_intro_early: boolean;
        provided_summary: boolean;
        asked_for_more_queries: boolean;
        upselling_attempted: boolean;
        polite_language_used: boolean;
    };
    toneAnalysis: ToneAnalysis; // NEW FIELD
}

interface PerformanceData {
    averageScore: number;
    totalCalls: number;
    averageHandleTime: number;
    satisfactionRate: number;
    escalationRate: number;
    averageToneMark: number; // NEW METRIC
}

// Data structure for the multi-agent hourly chart
interface HourlyVolumeData {
    hour: string;
    [key: string]: string | number; // Dynamic keys for agent calls (e.g., 'Agent Name')
}

// Fixed colors for the top/bottom agents and team average (10 agents + 1 team line)
const AGENT_COLORS = [
    '#3b82f6', // Blue (Top 1)
    '#10b981', // Green (Top 2)
    '#f59e0b', // Amber (Top 3)
    '#8b5cf6', // Violet (Top 4)
    '#06b6d4', // Cyan (Top 5)
    '#a855f7', // Purple (Bottom 5)
    '#fb7185', // Rose (Bottom 4)
    '#f43f5e', // Pink (Bottom 3)
    '#ef4444', // Red (Bottom 2)
    '#dc2626', // Dark Red (Bottom 1)
];
const TEAM_COLOR = '#9ca3af'; // Gray (Team Average)


const CustomTooltip = ({ active, payload, label, isDarkMode }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className={`p-4 rounded-xl shadow-2xl border backdrop-blur-sm ${
                isDarkMode
                    ? 'bg-gray-800/90 border-gray-600 text-white'
                    : 'bg-white/90 border-gray-200 text-gray-900'
            }`}>
                <p className="font-bold text-lg mb-2">Hour: {label}</p>
                {payload.map((p: any, index: number) => (
                    <p key={index} style={{ color: p.color }} className="font-semibold text-sm flex items-center justify-between">
                        <span className="flex items-center">
                            <span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: p.color }}></span>
                            {/* Display agent name/key */}
                            <span className="mr-2">{p.name}</span>
                        </span>
                        {/* Display ONLY the call count */}
                        <span className="font-bold">{p.value} calls</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const MetricBadge: React.FC<{
    value: number;
    label: string;
    color: string;
    icon?: React.ReactNode;
    isDarkMode: boolean;
}> = ({ value, label, color, icon, isDarkMode }) => (
    // Reduced padding and font size for badges
    <div className={`p-3 rounded-xl border-l-4 ${
        isDarkMode ? 'bg-gray-700/30' : 'bg-gray-50'
    } border-${color}-500`}>
        <div className="flex items-center justify-between">
            <div>
                <div className="text-xl font-bold mb-1" style={{ color: `var(--color-${color})` }}>
                    {value.toFixed(1)}
                    {label.includes('%') ? '%' : ''}
                </div>
                <div className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    {label}
                </div>
            </div>
            {React.cloneElement(icon as React.ReactElement, { size: 18 })}
        </div>
    </div>
);

const StatCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    value: string | number;
    change?: number;
    subtitle?: string;
    gradient: string;
    isDarkMode: boolean;
    pattern?: string;
}> = ({ icon, title, value, change, subtitle, gradient, isDarkMode, pattern }) => (
    // Reduced padding and font size for main StatCards
    <div className={`${gradient} rounded-2xl shadow-xl p-5 text-white transform hover:scale-105 transition-all duration-300 hover:shadow-2xl relative overflow-hidden`}>
        <div className={`absolute inset-0 opacity-10 ${pattern || 'bg-gradient-to-br from-white/20 to-transparent'}`}></div>
        <div className="relative z-10">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center mb-1">
                        <p className="text-xs font-medium opacity-90">{title}</p>
                        <Sparkles className="w-3 h-3 ml-1 opacity-75" />
                    </div>
                    <p className="text-3xl font-bold mt-1 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                        {value}
                    </p>
                    {subtitle && <p className="text-xs opacity-75 mt-1">{subtitle}</p>}
                    {change !== undefined && (
                        <div className={`flex items-center mt-2 text-xs px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm w-fit ${
                            change >= 0 ? 'text-green-200' : 'text-red-200'
                        }`}>
                            <TrendingUp className={`w-3 h-3 mr-1 ${change < 0 ? 'rotate-180' : ''}`} />
                            {Math.abs(change)}% {change >= 0 ? 'increase' : 'decrease'}
                        </div>
                    )}
                </div>
                <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                    {React.cloneElement(icon as React.ReactElement, { size: 22 })}
                </div>
            </div>
        </div>
    </div>
);

// Add 'tone_mark' to the list of skills
const allSkills = ['structure', 'clarity', 'confidence', 'closing', 'intro', 'call_summary', 'end_call', 'upselling', 'sympathy', 'tone_mark'] as const;

const ManagerAnalytics: React.FC<ManagerAnalyticsProps> = ({ user, isDarkMode }) => {
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
        start: subMonths(new Date(), 1),
        end: new Date()
    });
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [calls, setCalls] = useState<CallAnalysis[]>([]);
    const [performanceData, setPerformanceData] = useState<PerformanceData>({
        averageScore: 0,
        totalCalls: 0,
        averageHandleTime: 0,
        satisfactionRate: 0,
        escalationRate: 0,
        averageToneMark: 0 // NEW METRIC
    });
    const [loading, setLoading] = useState(true);

    const [performanceTrends, setPerformanceTrends] = useState<any[]>([]);
    const [agentComparison, setAgentComparison] = useState<any[]>([]);
    const [skillDistribution, setSkillDistribution] = useState<any[]>([]);
    const [coachingInsights, setCoachingInsights] = useState<any[]>([]);
    const [topObjections, setTopObjections] = useState<any[]>([]);
    const [hourlyMultiAgentVolume, setHourlyMultiAgentVolume] = useState<HourlyVolumeData[]>([]); // MODIFIED STATE
    const [filteringData, setFilteringData] = useState(false);

    const fetchAgents = async (): Promise<Agent[]> => {
        try {
            const agentsQuery = query(collection(db, 'agents'));
            const agentsSnapshot = await getDocs(agentsQuery);
            return agentsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Agent[];
        } catch (error) {
            console.error('Error fetching agents:', error);
            return [];
        }
    };

    const fetchCalls = async (agentId: string | null, dateRange: { start: Date; end: Date }, agentsList: Agent[]): Promise<CallAnalysis[]> => {
        const dateQueryConstraints = [
            where('timestamp', '>=', Timestamp.fromDate(dateRange.start)),
            where('timestamp', '<=', Timestamp.fromDate(endOfDay(dateRange.end))),
            orderBy('timestamp', 'desc')
        ];

        let callsQuery;

        if (agentId && agentId !== 'all') {
            const agent = agentsList.find(a => a.id === agentId);
            if (agent) {
                callsQuery = query(
                    collection(db, 'call_analysis'),
                    where('agentEmail', '==', agent.email),
                    ...dateQueryConstraints
                );
            } else {
                callsQuery = query(
                    collection(db, 'call_analysis'),
                    where('agentId', '==', agentId),
                    ...dateQueryConstraints
                );
            }
        } else {
            callsQuery = query(
                collection(db, 'call_analysis'),
                ...dateQueryConstraints
            );
        }

        try {
            const callsSnapshot = await getDocs(callsQuery);
            return callsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...(data as unknown as CallAnalysis),
                    callId: doc.id,
                    scores: data.scores || {},
                    toneAnalysis: data.toneAnalysis || { toneMark: 0 } // Ensure toneAnalysis exists
                } as CallAnalysis;
            });
        } catch (error) {
            console.error('Error fetching calls:', error);
            return [];
        }
    };

    const fetchAnalyticsData = async () => {
        setLoading(true);
        setFilteringData(true);
        try {
            const agentsData = await fetchAgents();
            setAgents(agentsData);

            // Important: Fetch all calls first, then filter/aggregate.
            const callsData = await fetchCalls(selectedAgentId, dateRange, agentsData);
            setCalls(callsData);
        } catch (error) {
            console.error('Error fetching analytics data:', error);
        } finally {
            setLoading(false);
            setFilteringData(false);
        }
    };

    useEffect(() => {
        fetchAnalyticsData();
    }, [dateRange, selectedAgentId]);

    useEffect(() => {
        if (calls.length > 0) {
            calculatePerformance(calls);
            generatePerformanceTrends(calls);
            generateSkillDistribution(calls);
            generateCoachingInsights(calls);
            generateTopObjections(calls);
            generateMultiAgentHourlyVolume(calls, agents, selectedAgentId); // UPDATED
        } else {
            setPerformanceData({
                averageScore: 0,
                totalCalls: 0,
                averageHandleTime: 0,
                satisfactionRate: 0,
                escalationRate: 0,
                averageToneMark: 0
            });
            setPerformanceTrends([]);
            setSkillDistribution([]);
            setCoachingInsights([]);
            setTopObjections([]);
            setHourlyMultiAgentVolume([]); // UPDATED
        }

        if (!selectedAgentId && agents.length > 0 && calls.length > 0) {
            generateAgentComparison(agents, calls);
        } else {
            setAgentComparison([]);
        }
    }, [calls, agents, selectedAgentId]);

    // MODIFIED FUNCTION for Multi-Line Chart Data to use ACTUAL NAMES as keys
    const generateMultiAgentHourlyVolume = (callsData: CallAnalysis[], agentsData: Agent[], selectedAgentId: string | null) => {
        const START_HOUR = 8; // 8 AM
        const END_HOUR = 20;  // 8 PM

        let agentsToTrack: Agent[] = [];
        let trackedKeys: { key: string, name: string }[] = [];

        if (selectedAgentId) {
            // Individual Agent View: Track only the selected agent
            const selectedAgent = agentsData.find(a => a.id === selectedAgentId);
            if (selectedAgent) {
                // Use actual agent name for the key and name
                trackedKeys.push({ key: selectedAgent.name, name: selectedAgent.name });
            }
        } else {
            // Team View: Track Top 5 and Bottom 5 agents + Team Average
            
            // Filter agents with call data and sort by score (logic from previous version)
            const sortedAgents = agentsData
                .filter(a => {
                    const agentCalls = callsData.filter(call => call.agentEmail === a.email);
                    return agentCalls.length > 0;
                })
                .sort((a, b) => {
                    const scoreA = callsData.filter(call => call.agentEmail === a.email).reduce((sum, call) => sum + (call.overallScore || 0), 0) / (callsData.filter(call => call.agentEmail === a.email).length || 1);
                    const scoreB = callsData.filter(call => call.agentEmail === b.email).reduce((sum, call) => sum + (call.overallScore || 0), 0) / (callsData.filter(call => call.agentEmail === b.email).length || 1);
                    return scoreB - scoreA;
                });

            const top5 = sortedAgents.slice(0, 5);
            const bottom5 = sortedAgents.slice(Math.max(sortedAgents.length - 5, 0));
            
            // Combine agents, filtering duplicates
            agentsToTrack = [...new Set([...top5, ...bottom5])];

            // Setup tracked keys using agent's actual name
            agentsToTrack.forEach((agent) => {
                // Key and Name are the actual agent name
                trackedKeys.push({ key: agent.name, name: agent.name });
            });

            // Add Team Average as the last line
            trackedKeys.push({ key: 'Team Average', name: 'Team Average' });
        }

        // 1. Calculate hourly counts for each tracked agent and the team total
        const hourlyDataMap = callsData.reduce((acc, call) => {
            const callDate = call.timestamp?.toDate();
            if (!callDate) return acc;
            
            const hour = getHours(callDate);
            const hourKey = hour.toString();
            
            const agentName = agentsData.find(a => a.email === call.agentEmail)?.name;
            
            // Find the tracked line key/name based on the agent's name
            const trackedLine = selectedAgentId
                ? trackedKeys[0] // Only the selected agent
                : trackedKeys.find(k => k.key === agentName);
            
            // Initialize hour in map if needed
            if (!acc[hourKey]) {
                acc[hourKey] = { hour: hour.toString() };
                trackedKeys.forEach(key => acc[hourKey][key.name] = 0);
            }

            // Increment individual agent's calls 
            if (trackedLine) {
                acc[hourKey][trackedLine.name] = (acc[hourKey][trackedLine.name] as number) + 1;
            }

            // Increment team total if in team view
            if (!selectedAgentId) {
                 acc[hourKey]['Team Average'] = (acc[hourKey]['Team Average'] as number) + 1;
            }

            return acc;
        }, {} as Record<string, HourlyVolumeData>);


        // 2. Format the data for the LineChart (8 AM to 8 PM)
        const finalData: HourlyVolumeData[] = [];
        for (let h = START_HOUR; h <= END_HOUR; h++) {
            const hourKey = h.toString();
            const date = new Date();
            date.setHours(h, 0, 0, 0);

            const formattedPoint: HourlyVolumeData = {
                hour: format(date, 'h a'),
            };

            // Populate calls for each tracked line
            trackedKeys.forEach(trackedLine => {
                // Use trackedLine.name (which is the actual agent name or 'Team Average') as the key
                formattedPoint[trackedLine.name] = (hourlyDataMap[hourKey] && hourlyDataMap[hourKey][trackedLine.name]) || 0;
            });
            
            finalData.push(formattedPoint);
        }

        setHourlyMultiAgentVolume(finalData);
    };


    const calculatePerformance = (callsData: CallAnalysis[]) => {
        if (callsData.length === 0) {
            setPerformanceData({
                averageScore: 0,
                totalCalls: 0,
                averageHandleTime: 0,
                satisfactionRate: 0,
                escalationRate: 0,
                averageToneMark: 0
            });
            return;
        }

        const totalScore = callsData.reduce((sum, call) => sum + (call.overallScore || 0), 0);
        const totalDuration = callsData.reduce((sum, call) => sum + (call.duration || 0), 0);
        // NEW: Calculate total Tone Mark
        const totalToneMark = callsData.reduce((sum, call) => sum + (call.toneAnalysis?.toneMark || 0), 0);

        const satisfiedCalls = callsData.filter(call => {
            const sentiment = (call.sentiment || '').toLowerCase();
            return sentiment.includes('positive') || sentiment.includes('neutral');
        }).length;

        const escalatedCalls = callsData.filter(call =>
            call.coachingTips?.some(tip =>
                tip.toLowerCase().includes('escalat') ||
                tip.toLowerCase().includes('manager') ||
                tip.toLowerCase().includes('supervisor')
            )
        ).length;

        setPerformanceData({
            averageScore: parseFloat((totalScore / callsData.length).toFixed(1)),
            totalCalls: callsData.length,
            averageHandleTime: Math.round(totalDuration / callsData.length),
            satisfactionRate: parseFloat(((satisfiedCalls / callsData.length) * 100).toFixed(1)),
            escalationRate: parseFloat(((escalatedCalls / callsData.length) * 100).toFixed(1)),
            averageToneMark: parseFloat((totalToneMark / callsData.length).toFixed(1)) // NEW
        });
    };

    const generatePerformanceTrends = (callsData: CallAnalysis[]) => {
        const trends = eachDayOfInterval({ start: dateRange.start, end: dateRange.end })
            .map(day => {
                const dayCalls = callsData.filter(call => {
                    const callDate = call.timestamp?.toDate();
                    return callDate && format(callDate, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd');
                });
                const dailyScore = dayCalls.length > 0
                    ? dayCalls.reduce((sum, call) => sum + (call.overallScore || 0), 0) / dayCalls.length
                    : 0;
                return {
                    date: format(day, 'MMM dd'),
                    score: parseFloat(dailyScore.toFixed(1)),
                    calls: dayCalls.length,
                };
            });
        setPerformanceTrends(trends);
    };

    const generateAgentComparison = (agentsData: Agent[], callsData: CallAnalysis[]) => {
        const comparison = agentsData.map(agent => {
            const agentCalls = callsData.filter(call => call.agentEmail === agent.email);
            const agentScore = agentCalls.length > 0
                ? agentCalls.reduce((sum, call) => sum + (call.overallScore || 0), 0) / agentCalls.length
                : 0;
            const totalDuration = agentCalls.reduce((sum, call) => sum + (call.duration || 0), 0);

            return {
                name: agent.name.split(' ')[0], // First name only for compact display
                fullName: agent.name,
                score: parseFloat(agentScore.toFixed(1)),
                calls: agentCalls.length,
                duration: totalDuration,
                avgHandleTime: agentCalls.length > 0 ? Math.round(totalDuration / agentCalls.length) : 0
            };
        }).filter(agent => agent.calls > 0).sort((a, b) => b.score - a.score);

        setAgentComparison(comparison);
    };

    // Use the updated allSkills array
    const generateSkillDistribution = (callsData: CallAnalysis[]) => {
        const skillSums: { [key: string]: number } = {};
        const skillCounts: { [key: string]: number } = {};
        const skillTrends: { [key: string]: number[] } = {};

        callsData.forEach(call => {
            // Iterate over the combined skill list (including tone_mark)
            for (const skill of allSkills) {
                // Determine the score source
                let score: number | undefined;
                if (skill === 'tone_mark') {
                    score = call.toneAnalysis?.toneMark;
                } else if (call.scores) {
                    score = call.scores[skill as keyof typeof call.scores];
                }

                if (score !== undefined) {
                    skillSums[skill] = (skillSums[skill] || 0) + score;
                    skillCounts[skill] = (skillCounts[skill] || 0) + 1;

                    if (!skillTrends[skill]) skillTrends[skill] = [];
                    skillTrends[skill].push(score);
                }
            }
        });

        const distribution = allSkills.map(skill => {
            const averageScore = skillCounts[skill] > 0
                ? skillSums[skill] / skillCounts[skill]
                : 0;

            let trend = 0;
            const scores = skillTrends[skill] || [];
            if (scores.length > 1) {
                const recentScores = scores.slice(-3);
                const olderScores = scores.slice(0, -3);
                if (olderScores.length > 0) {
                    const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
                    const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
                    trend = recentAvg - olderAvg;
                }
            }
            
            // Custom label for Tone Mark
            let displaySkill = skill.charAt(0).toUpperCase() + skill.slice(1).replace(/_/g, ' ');
            if (skill === 'tone_mark') {
                displaySkill = 'Tone Mark';
            }

            return {
                skill: displaySkill,
                score: parseFloat(averageScore.toFixed(1)),
                trend,
                fullMark: 10,
            };
        });

        setSkillDistribution(distribution);
    };

    const generateCoachingInsights = (callsData: CallAnalysis[]) => {
        const tipCounts = callsData.flatMap(call => call.coachingTips || [])
            .reduce((acc, tip) => {
                acc[tip] = (acc[tip] || 0) + 1;
                return acc;
            }, {} as { [key: string]: number });
        const insights = Object.entries(tipCounts).sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([tip, frequency]) => ({ tip, frequency }));
        setCoachingInsights(insights);
    };

    const generateTopObjections = (callsData: CallAnalysis[]) => {
        const objectionCounts = callsData.flatMap(call => call.objections || [])
            .reduce((acc, objection) => {
                acc[objection] = (acc[objection] || 0) + 1;
                return acc;
            }, {} as { [key: string]: number });
        const objections = Object.entries(objectionCounts).sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([objection, frequency]) => ({ objection, frequency }));
        setTopObjections(objections);
    };

    const handleDateRangeChange = (start: Date, end: Date) => {
        setDateRange({ start, end });
    };

    const handleDownloadData = () => {
        if (calls.length === 0) {
            alert("No data to download.");
            return;
        }
        const headers = [
            "Call ID", "Agent Name", "Timestamp", "Duration (s)", "Overall Score", "Tone Mark", "Sentiment",
            "Language", "Talk Ratio", "Objections", "Coaching Tips"
        ];
        const csvRows = calls.map(call => [
            call.callId,
            call.agentName,
            call.timestamp?.toDate().toLocaleString(),
            call.duration,
            call.overallScore,
            call.toneAnalysis?.toneMark || 0, // Include Tone Mark
            call.sentiment,
            call.language,
            call.talkRatio,
            `"${(call.objections || []).join('; ')}"`,
            `"${(call.coachingTips || []).join('; ')}"`
        ].join(','));
        const csvContent = [headers.join(','), ...csvRows].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `call_analytics_${format(dateRange.start, 'yyyyMMdd')}_to_${format(dateRange.end, 'yyyyMMdd')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const selectedAgentName = selectedAgentId ? agents.find(a => a.id === selectedAgentId)?.name : 'Team';

    const individualAgentMetrics = useMemo(() => {
        if (!selectedAgentId || calls.length === 0) return null;

        const positiveCalls = calls.filter(call =>
            (call.sentiment || '').toLowerCase().includes('positive')
        ).length;

        const callsWithObjections = calls.filter(call =>
            call.objections && call.objections.length > 0
        ).length;

        const avgObjectionsPerCall = calls.length > 0 ?
            calls.reduce((sum, call) => sum + (call.objections?.length || 0), 0) / calls.length : 0;

        const bestCall = calls.reduce((best, call) =>
            (call.overallScore || 0) > (best.overallScore || 0) ? call : best, calls[0]
        );

        const worstCall = calls.reduce((worst, call) =>
            (call.overallScore || 0) < (worst.overallScore || 0) ? call : worst, calls[0]
        );

        return {
            positiveCallRate: (positiveCalls / calls.length) * 100,
            objectionRate: (callsWithObjections / calls.length) * 100,
            avgObjectionsPerCall,
            bestScore: bestCall.overallScore || 0,
            worstScore: worstCall.overallScore || 0,
            consistency: performanceData.averageScore > 0 ? Math.max(0, ((performanceData.averageScore - (worstCall.overallScore || 0)) / performanceData.averageScore) * 100) : 0,
        };
    }, [selectedAgentId, calls, performanceData]);

    // Use Memo to extract line keys for the LineChart rendering
    const lineKeys = useMemo(() => {
        if (hourlyMultiAgentVolume.length === 0) return [];
        // The keys are everything except 'hour'
        return Object.keys(hourlyMultiAgentVolume[0]).filter(key => key !== 'hour');
    }, [hourlyMultiAgentVolume]);


    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${
                isDarkMode
                    ? 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20'
                    : 'bg-gradient-to-br from-purple-50 via-blue-50 to-cyan-50'
            }`}>
                <div className="text-center">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-32 w-32 border-4 border-purple-200"></div>
                        <div className="animate-spin rounded-full h-32 w-32 border-t-4 border-purple-600 absolute top-0"></div>
                    </div>
                    <div className="mt-8">
                        <h3 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Loading Analytics...
                        </h3>
                        <p className={`text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Crunching the numbers for insights
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const hasData = calls.length > 0;

    return (
        <div className={`min-h-screen p-6 transition-all duration-500 ${
            isDarkMode
                ? 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-blue-900/20 text-gray-100'
                : 'bg-gradient-to-br from-purple-50 via-blue-50 to-cyan-50'
        }`}>
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                        isDarkMode
                            ? 'bg-gray-800/50 border-gray-700'
                            : 'bg-white/70 border-white'
                    }`}>
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                            <div>
                                <div className="flex items-center mb-4">
                                    <BarChart3 className={`w-10 h-10 mr-4 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                    <div>
                                        <h1 className={`text-4xl font-bold bg-gradient-to-r ${
                                            isDarkMode
                                                ? 'from-purple-400 to-blue-400'
                                                : 'from-purple-600 to-blue-600'
                                            } bg-clip-text text-transparent`}>
                                            {selectedAgentId ? `${selectedAgentName}'s` : 'Team'} Analytics Hub
                                        </h1>
                                        <div className="flex items-center mt-2">
                                            <Zap className={`w-5 h-5 mr-2 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-500'}`} />
                                            <p className={`text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                AI-powered insights for peak performance
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                                <div className={`flex items-center space-x-3 px-4 py-3 rounded-2xl border transition-all duration-300 w-full md:w-auto ${
                                    isDarkMode
                                        ? 'bg-gray-700/50 border-gray-600 hover:border-purple-500'
                                        : 'bg-white/80 border-gray-200 hover:border-purple-300'
                                }`}>
                                    <Users className={`${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} size={20} />
                                    <select
                                        value={selectedAgentId || 'all'}
                                        onChange={(e) => setSelectedAgentId(e.target.value === 'all' ? null : e.target.value)}
                                        className={`bg-transparent border-none focus:outline-none font-medium w-full ${
                                            isDarkMode ? 'text-white' : 'text-gray-900'
                                        }`}
                                    >
                                        <option value="all">All Agents</option>
                                        {agents.map(agent => (
                                            <option key={agent.id} value={agent.id}>
                                                {agent.name} ({agent.stats?.totalCalls || 0} calls)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className={`flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4 px-4 py-3 rounded-2xl border transition-all duration-300 w-full md:w-auto ${
                                    isDarkMode
                                        ? 'bg-gray-700/50 border-gray-600 hover:border-purple-500'
                                        : 'bg-white/80 border-gray-200 hover:border-purple-300'
                                }`}>
                                    
                                    {/* Start Date */}
                                    <div className="relative flex items-center w-full sm:w-32">
                                        <input
                                            type="text"
                                            placeholder="DD-MM-YYYY"
                                            defaultValue={format(dateRange.start, 'dd-MM-yyyy')}
                                            key={`start-${dateRange.start.getTime()}`}
                                            onBlur={(e) => {
                                                const match = e.target.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                                                if (match) {
                                                    const [_, day, month, year] = match;
                                                    const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                    const today = new Date();
                                                    
                                                    if (!isNaN(parsed.getTime())) {
                                                        if (parsed > today) {
                                                            e.target.value = format(dateRange.start, 'dd-MM-yyyy');
                                                        } else {
                                                            handleDateRangeChange(startOfDay(parsed), dateRange.end);
                                                        }
                                                    }
                                                } else {
                                                    e.target.value = format(dateRange.start, 'dd-MM-yyyy');
                                                }
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                            className={`bg-transparent border-none focus:outline-none font-medium w-full pr-8 tracking-wide ${
                                                isDarkMode ? 'text-white' : 'text-gray-900'
                                            }`}
                                        />
                                        <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-5 h-5 overflow-hidden cursor-pointer">
                                            <Calendar size={18} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                            <input
                                                type="date"
                                                max={format(new Date(), 'yyyy-MM-dd')}
                                                value={format(dateRange.start, 'yyyy-MM-dd')}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        const parsed = new Date(e.target.value);
                                                        if (parsed <= new Date()) {
                                                            handleDateRangeChange(startOfDay(parsed), dateRange.end);
                                                        }
                                                    }
                                                }}
                                                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                            />
                                        </div>
                                    </div>

                                    <span className={`hidden sm:inline font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>to</span>

                                    {/* End Date */}
                                    <div className="relative flex items-center w-full sm:w-32">
                                        <input
                                            type="text"
                                            placeholder="DD-MM-YYYY"
                                            defaultValue={format(dateRange.end, 'dd-MM-yyyy')}
                                            key={`end-${dateRange.end.getTime()}`}
                                            onBlur={(e) => {
                                                const match = e.target.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                                                if (match) {
                                                    const [_, day, month, year] = match;
                                                    const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                                                    const today = new Date();
                                                    
                                                    if (!isNaN(parsed.getTime())) {
                                                        if (parsed > today) {
                                                            e.target.value = format(dateRange.end, 'dd-MM-yyyy');
                                                        } else {
                                                            handleDateRangeChange(dateRange.start, endOfDay(parsed));
                                                        }
                                                    }
                                                } else {
                                                    e.target.value = format(dateRange.end, 'dd-MM-yyyy');
                                                }
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                            className={`bg-transparent border-none focus:outline-none font-medium w-full pr-8 tracking-wide ${
                                                isDarkMode ? 'text-white' : 'text-gray-900'
                                            }`}
                                        />
                                        <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-5 h-5 overflow-hidden cursor-pointer">
                                            <Calendar size={18} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                                            <input
                                                type="date"
                                                max={format(new Date(), 'yyyy-MM-dd')}
                                                value={format(dateRange.end, 'yyyy-MM-dd')}
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        const parsed = new Date(e.target.value);
                                                        if (parsed <= new Date()) {
                                                            handleDateRangeChange(dateRange.start, endOfDay(parsed));
                                                        }
                                                    }
                                                }}
                                                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={handleDownloadData}
                                        className={`p-3 rounded-xl transition-all duration-300 flex items-center justify-center ${
                                            isDarkMode
                                                ? 'bg-gray-700/50 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white'
                                                : 'bg-white/80 hover:bg-white border border-gray-200 text-gray-600 hover:text-gray-900'
                                        }`}
                                    >
                                        <Download size={20} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                    <StatCard
                        icon={<Award size={22} />}
                        title={`${selectedAgentId ? selectedAgentName + ' Score' : 'Team Performance Score'}`}
                        value={`${performanceData.averageScore.toFixed(1)}/10`}
                        gradient="bg-gradient-to-br from-purple-500 via-purple-600 to-indigo-600"
                        change={performanceData.averageScore > 7 ? 12 : -3}
                        isDarkMode={isDarkMode}
                    />
                    {/* NEW TONE MARK STAT CARD */}
                    <StatCard
                        icon={<Mic size={22} />}
                        title="Average Tone Mark"
                        value={`${performanceData.averageToneMark.toFixed(1)}/10`}
                        gradient="bg-gradient-to-br from-pink-500 via-pink-600 to-rose-600"
                        change={performanceData.averageToneMark > 7 ? 8 : -5}
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        icon={<Phone size={22} />}
                        title="Total Calls Analyzed"
                        value={performanceData.totalCalls.toLocaleString()}
                        gradient="bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-600"
                        change={15}
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        icon={<Clock size={22} />}
                        title="Average Handle Time"
                        value={`${Math.floor(performanceData.averageHandleTime / 60)}m ${performanceData.averageHandleTime % 60}s`}
                        gradient="bg-gradient-to-br from-emerald-500 via-green-600 to-teal-600"
                        change={-8}
                        isDarkMode={isDarkMode}
                    />
                    <StatCard
                        icon={<ThumbsUp size={22} />}
                        title="Satisfaction Rate"
                        value={`${performanceData.satisfactionRate.toFixed(1)}%`}
                        gradient="bg-gradient-to-br from-amber-500 via-orange-600 to-red-600"
                        change={5}
                        isDarkMode={isDarkMode}
                    />
                </div>

                {!hasData ? (
                    <div className={`rounded-3xl shadow-2xl p-12 text-center backdrop-blur-sm border transition-all duration-300 ${
                        isDarkMode
                            ? 'bg-gray-800/50 border-gray-700'
                            : 'bg-white/70 border-white'
                    }`}>
                        <div className="max-w-md mx-auto">
                            <Activity className={`w-24 h-24 mx-auto mb-6 ${
                                isDarkMode ? 'text-gray-600' : 'text-gray-400'
                            }`} />
                            <h3 className={`text-2xl font-bold mb-4 ${
                                isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                                No Data Available
                            </h3>
                            <p className={`text-lg mb-6 ${
                                isDarkMode ? 'text-gray-400' : 'text-gray-600'
                            }`}>
                                {selectedAgentId
                                    ? `${selectedAgentName} has no calls in the selected date range.`
                                    : 'No calls found for the selected date range.'
                                }
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* 1. Hourly Call Volume Chart (MULTI-LINE) */}
                        <div className={`rounded-3xl shadow-2xl p-8 mb-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                            isDarkMode
                                ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50'
                                : 'bg-white/70 border-white hover:border-blue-200'
                        }`}>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                                <div className="flex items-center mb-4 sm:mb-0">
                                    <Phone className={`w-8 h-8 mr-4 ${
                                        isDarkMode ? 'text-yellow-400' : 'text-yellow-600'
                                    }`} />
                                    <div>
                                        <h3 className={`text-2xl font-bold ${
                                            isDarkMode ? 'text-white' : 'text-gray-900'
                                        }`}>
                                            Hourly Call Distribution
                                        </h3>
                                        <p className={`text-sm ${
                                            isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                        }`}>
                                            {selectedAgentId
                                                ? `Call volume over time for ${selectedAgentName}.`
                                                : `Call volume comparison across agents (${format(dateRange.start, 'MMM dd')} - ${format(dateRange.end, 'MMM dd')})`
                                            }
                                        </p>
                                    </div>
                                </div>
                                {!selectedAgentId && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                                        {/* RENDER LEGEND WITH ACTUAL AGENT NAMES */}
                                        {lineKeys.map((key, index) => {
                                            const isTeam = key === 'Team Average';
                                            let color;

                                            if (isTeam) {
                                                color = TEAM_COLOR;
                                            } else {
                                                // Color indexing logic remains the same
                                                color = AGENT_COLORS[index % AGENT_COLORS.length];
                                            }

                                            return (
                                                <div key={key} className="flex items-center">
                                                    <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: color }}></div>
                                                    <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{key}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={hourlyMultiAgentVolume} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke={isDarkMode ? '#374151' : '#e5e7eb'}
                                            vertical={false}
                                        />
                                        <XAxis
                                            dataKey="hour"
                                            stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
                                            fontSize={12}
                                            interval={0}
                                        />
                                        <YAxis
                                            stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
                                            fontSize={12}
                                        />
                                        {/* Using the modified CustomTooltip */}
                                        <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />

                                        {/* Dynamically render lines for all tracked keys */}
                                        {lineKeys.map((key, index) => {
                                            const isTeam = key === 'Team Average';
                                            let color;

                                            if (isTeam) {
                                                color = TEAM_COLOR;
                                            } else {
                                                // Color indexing logic remains the same
                                                color = AGENT_COLORS[index % AGENT_COLORS.length];
                                            }

                                            const strokeWidth = isTeam ? 3 : 2;

                                            return (
                                                <Line
                                                    key={key}
                                                    type="monotone"
                                                    dataKey={key}
                                                    stroke={color}
                                                    strokeWidth={strokeWidth}
                                                    dot={{ r: strokeWidth === 3 ? 5 : 3, strokeWidth: 2, fill: color }}
                                                    activeDot={{ r: 8 }}
                                                    name={key} // Key is the actual name (or "Team Average")
                                                />
                                            );
                                        })}

                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* 2. Performance Trends Chart */}
                        <div className={`rounded-3xl shadow-2xl p-8 mb-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                            isDarkMode
                                ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50'
                                : 'bg-white/70 border-white hover:border-blue-200'
                        }`}>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                                <div className="flex items-center mb-4 sm:mb-0">
                                    <TrendingUp className={`w-8 h-8 mr-4 ${
                                        isDarkMode ? 'text-blue-400' : 'text-blue-600'
                                    }`} />
                                    <div>
                                        <h3 className={`text-2xl font-bold ${
                                            isDarkMode ? 'text-white' : 'text-gray-900'
                                        }`}>
                                            Performance Trends
                                        </h3>
                                        <p className={`text-sm ${
                                            isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                        }`}>
                                            Daily score progression and call volume
                                        </p>
                                    </div>
                                </div>
                                <div className={`px-4 py-2 rounded-xl ${
                                    isDarkMode ? 'bg-gray-700/50' : 'bg-gray-100'
                                }`}>
                                    <span className={`text-sm font-medium ${
                                        isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                        {format(dateRange.start, 'MMM dd')} - {format(dateRange.end, 'MMM dd')}
                                    </span>
                                </div>
                            </div>

                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={performanceTrends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke={isDarkMode ? '#374151' : '#e5e7eb'}
                                        />
                                        <XAxis
                                            dataKey="date"
                                            stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
                                            fontSize={12}
                                        />
                                        <YAxis
                                            stroke={isDarkMode ? '#9ca3af' : '#6b7280'}
                                            fontSize={12}
                                        />
                                        <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                                        <Area
                                            type="monotone"
                                            dataKey="score"
                                            stroke="#8884d8"
                                            fillOpacity={1}
                                            fill="url(#colorScore)"
                                            name="Average Score"
                                            unit="/10"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                            {/* Left Column: Agent Comparison or Individual Metrics */}
                            {selectedAgentId ? (
                                // Individual Agent Metrics Section
                                <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                                    isDarkMode
                                        ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50'
                                        : 'bg-white/70 border-white hover:border-blue-200'
                                }`}>
                                    <div className="flex items-center mb-8">
                                        <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 mr-4">
                                            <Users className="text-white" size={28} />
                                        </div>
                                        <div>
                                            <h3 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                {selectedAgentName}'s Deep Dive
                                            </h3>
                                            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                Detailed individual performance analysis
                                            </p>
                                        </div>
                                    </div>

                                    {individualAgentMetrics && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                                            <MetricBadge
                                                value={individualAgentMetrics.bestScore}
                                                label="Best Call Score"
                                                color="green"
                                                icon={<Star className="text-green-500" size={20} />}
                                                isDarkMode={isDarkMode}
                                            />
                                            <MetricBadge
                                                value={individualAgentMetrics.worstScore}
                                                label="Lowest Score"
                                                color="red"
                                                icon={<TrendingDown className="text-red-500" size={20} />}
                                                isDarkMode={isDarkMode}
                                            />
                                            <MetricBadge
                                                value={individualAgentMetrics.positiveCallRate}
                                                label="Positive Calls"
                                                color="blue"
                                                icon={<ThumbsUp className="text-blue-500" size={20} />}
                                                isDarkMode={isDarkMode}
                                            />
                                            <MetricBadge
                                                value={individualAgentMetrics.objectionRate}
                                                label="Calls with Objections"
                                                color="orange"
                                                icon={<Shield className="text-orange-500" size={20} />}
                                                isDarkMode={isDarkMode}
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                // Agent Comparison Section
                                agentComparison.length > 0 && (
                                    <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                                        isDarkMode
                                            ? 'bg-gray-800/50 border-gray-700 hover:border-green-500/50'
                                            : 'bg-white/70 border-white hover:border-green-200'
                                    }`}>
                                        <div className="flex items-center mb-8">
                                            <Users className={`w-8 h-8 mr-4 ${
                                                isDarkMode ? 'text-green-400' : 'text-green-600'
                                            }`} />
                                            <div>
                                                <h3 className={`text-2xl font-bold ${
                                                    isDarkMode ? 'text-white' : 'text-gray-900'
                                                }`}>
                                                    Agent Performance Ranking
                                                </h3>
                                                <p className={`text-sm ${
                                                    isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                                }`}>
                                                    Team performance comparison
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                                            {agentComparison.map((agent, index) => (
                                                <div key={agent.name} className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-105 ${
                                                    isDarkMode
                                                        ? 'bg-gray-700/30 border-gray-600 hover:border-green-500'
                                                        : 'bg-white/50 border-gray-200 hover:border-green-300'
                                                }`}>
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold mr-4 ${
                                                                index === 0
                                                                    ? 'bg-yellow-500 text-white'
                                                                    : index === 1
                                                                        ? 'bg-gray-400 text-white'
                                                                        : index === 2
                                                                            ? 'bg-orange-500 text-white'
                                                                            : 'bg-gray-600 text-white'
                                                            }`}>
                                                                {index + 1}
                                                            </div>
                                                            <div>
                                                                <div className={`font-semibold ${
                                                                    isDarkMode ? 'text-white' : 'text-gray-900'
                                                                }`}>
                                                                    {agent.fullName}
                                                                </div>
                                                                <div className={`text-sm ${
                                                                    isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                                                }`}>
                                                                    {agent.calls} calls &bull; {agent.avgHandleTime}s avg
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className={`text-2xl font-bold ${
                                                            agent.score >= 8 ? 'text-green-500' :
                                                                agent.score >= 6 ? 'text-yellow-500' :
                                                                    'text-red-500'
                                                        }`}>
                                                            {agent.score}
                                                        </div>
                                                    </div>
                                                    <div className={`mt-3 h-2 rounded-full overflow-hidden ${
                                                        isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
                                                    }`}>
                                                        <div
                                                            className="h-2 rounded-full bg-gradient-to-r from-green-500 to-cyan-500 transition-all duration-1000"
                                                            style={{ width: `${(agent.score / 10) * 100}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {agentComparison.length > 5 && (
                                            <p className={`text-center text-sm mt-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                Scroll to view all agents.
                                            </p>
                                        )}
                                    </div>
                                )
                            )}

                            {/* Right Column: Skill Distribution */}
                            {skillDistribution.length > 0 && (
                                <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                                    isDarkMode
                                        ? 'bg-gray-800/50 border-gray-700 hover:border-purple-500/50'
                                        : 'bg-white/70 border-white hover:border-purple-200'
                                }`}>
                                    <div className="flex items-center mb-8">
                                        <PieChartIcon className={`w-8 h-8 mr-4 ${
                                            isDarkMode ? 'text-purple-400' : 'text-purple-600'
                                        }`} />
                                        <div>
                                            <h3 className={`text-2xl font-bold ${
                                                isDarkMode ? 'text-white' : 'text-gray-900'
                                            }`}>
                                                Skill Distribution
                                            </h3>
                                            <p className={`text-sm ${
                                                isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                            }`}>
                                                Average scores across key competencies (including **Tone Mark**)
                                            </p>
                                        </div>
                                    </div>

                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RadarChart data={skillDistribution}>
                                                <PolarGrid stroke={isDarkMode ? '#4b5563' : '#d1d5db'} />
                                                <PolarAngleAxis
                                                    dataKey="skill"
                                                    tick={{ fill: isDarkMode ? '#e5e7eb' : '#374151', fontSize: 12 }}
                                                />
                                                <PolarRadiusAxis
                                                    angle={30}
                                                    domain={[0, 10]}
                                                    tick={{ fill: isDarkMode ? '#9ca3af' : '#6b7280', fontSize: 10 }}
                                                />
                                                <Radar
                                                    name="Skills"
                                                    dataKey="score"
                                                    stroke="#8884d8"
                                                    fill="#8884d8"
                                                    fillOpacity={0.6}
                                                />
                                                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                                            </RadarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Coaching Insights and Top Objections */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                            {/* Coaching Insights */}
                            <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                                isDarkMode
                                    ? 'bg-gray-800/50 border-gray-700 hover:border-orange-500/50'
                                    : 'bg-white/70 border-white hover:border-orange-200'
                            }`}>
                                <div className="flex items-center mb-8">
                                    <Target className={`w-8 h-8 mr-4 ${
                                        isDarkMode ? 'text-orange-400' : 'text-orange-600'
                                    }`} />
                                    <div>
                                        <h3 className={`text-2xl font-bold ${
                                            isDarkMode ? 'text-white' : 'text-gray-900'
                                        }`}>
                                            Top Coaching Opportunities
                                        </h3>
                                        <p className={`text-sm ${
                                            isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                        }`}>
                                            Most frequent coaching tips
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {coachingInsights.map((insight, index) => (
                                        <div key={index} className={`p-4 rounded-2xl border-l-4 border-orange-500 transition-all duration-300 hover:scale-105 ${
                                            isDarkMode
                                                ? 'bg-gray-700/30 border-gray-600'
                                                : 'bg-white/50 border-gray-200'
                                        }`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <span className={`font-semibold ${
                                                    isDarkMode ? 'text-white' : 'text-gray-900'
                                                }`}>
                                                    {insight.tip}
                                                </span>
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                    isDarkMode ? 'bg-orange-500/20 text-orange-300' : 'bg-orange-100 text-orange-700'
                                                }`}>
                                                    {insight.frequency} occurrences
                                                </span>
                                            </div>
                                            <div className={`text-sm ${
                                                isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                            }`}>
                                                Appears in {((insight.frequency / calls.length) * 100).toFixed(1)}% of calls
                                            </div>
                                        </div>
                                    ))}
                                </div>

                            </div>

                            {/* Top Objections */}
                            <div className={`rounded-3xl shadow-2xl p-8 backdrop-blur-sm border transition-all duration-300 hover:shadow-3xl ${
                                isDarkMode
                                    ? 'bg-gray-800/50 border-gray-700 hover:border-red-500/50'
                                    : 'bg-white/70 border-white hover:border-red-200'
                            }`}>
                                <div className="flex items-center mb-8">
                                    <Shield className={`w-8 h-8 mr-4 ${
                                        isDarkMode ? 'text-red-400' : 'text-red-600'
                                    }`} />
                                    <div>
                                        <h3 className={`text-2xl font-bold ${
                                            isDarkMode ? 'text-white' : 'text-gray-900'
                                        }`}>
                                            Common Objections
                                        </h3>
                                        <p className={`text-sm ${
                                            isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                        }`}>
                                            Most frequent customer objections
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {topObjections.map((obj, index) => (
                                        <div key={index} className={`p-4 rounded-2xl border-l-4 border-red-500 transition-all duration-300 hover:scale-105 ${
                                            isDarkMode
                                                ? 'bg-gray-700/30 border-gray-600'
                                                : 'bg-white/50 border-gray-200'
                                        }`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <span className={`font-semibold ${
                                                    isDarkMode ? 'text-white' : 'text-gray-900'
                                                }`}>
                                                    {obj.objection}
                                                </span>
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                    isDarkMode ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {obj.frequency} occurrences
                                                </span>
                                            </div>
                                            <div className={`text-sm ${
                                                isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                            }`}>
                                                Appears in {((obj.frequency / calls.length) * 100).toFixed(1)}% of calls
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ManagerAnalytics;