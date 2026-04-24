import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from 'recharts';
import { User } from '../../types';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import moment from 'moment';
import 'moment-timezone'; // This import extends the moment object with timezone functionality

interface AgentDashboardProps {
  user: User;
  isDarkMode: boolean; // Add isDarkMode prop
}

interface AgentStats {
  id: string;
  stats: {
    totalCalls: number;
    overallScore: number;
  };
}

interface DailyStats {
  callCount: number;
  totalDuration: number;
  avgScore: number;
  date: string;
}

interface CallAnalysis {
  overallScore: number;
  duration: number;
  timestamp: Timestamp;
  scores: {
    structure: number;
    clarity: number;
    confidence: number;
    closing: number;
  };
  sentiment: string;
  fillerWords: number;
  talkRatio: string;
}

type TimeFrame = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth';

const timeFrames: Record<TimeFrame, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
};

const CustomTooltip = ({ active, payload, label, isDarkMode }: any) => {
  if (active && payload && payload.length) {
    // Label can be a day (for daily trend) or an hour (for hourly distribution)
    const data = payload[0].payload;
    return (
      <div className={`p-4 rounded-lg shadow-lg border backdrop-blur-sm ${
        isDarkMode
          ? 'bg-gray-800/95 border-gray-600 text-white'
          : 'bg-white/95 border-gray-200 text-gray-900'
      }`}>
        <p className="font-bold text-lg mb-2">{label}</p>
        {payload.map((p: any, index: number) => (
          <p key={index} style={{ color: p.color }} className="font-semibold text-sm">
            {/* Added a check for 'score' to handle the RadialBarChart's non-standard payload */}
            {`${p.name}: ${p.value}${p.name === 'Total Calls' || p.name === 'Avg Score' ? '' : p.name === 'Avg Duration (min)' ? '' : p.name === 'score' ? '%' : ''}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Define the target timezone
const TARGET_TIMEZONE = 'Asia/Kolkata'; // IST (UTC+5:30)

export default function AgentDashboard({ user, isDarkMode }: AgentDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('thisWeek');
  const [stats, setStats] = useState([
    { title: "Today's Calls", value: '0', change: 'Loading...', color: 'text-blue-600', bgGradient: 'bg-gradient-to-br from-blue-50 to-blue-100', icon: '📞' },
    { title: 'Total Calls', value: '0', change: 'Loading...', color: 'text-orange-600', bgGradient: 'bg-gradient-to-br from-orange-50 to-orange-100', icon: '🎯' },
    { title: 'Avg Call Score', value: '0', change: 'Loading...', color: 'text-green-600', bgGradient: 'bg-gradient-to-br from-green-50 to-green-100', icon: '📈' },
    { title: 'Avg Handle Time', value: '0m', change: 'Loading...', color: 'text-purple-600', bgGradient: 'bg-gradient-to-br from-purple-50 to-purple-100', icon: '⏱️' },
  ]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [callOutcomes, setCallOutcomes] = useState<any[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);

  const colorMode = useMemo(() => {
    return isDarkMode ? {
      textPrimary: 'text-white',
      textSecondary: 'text-gray-400',
      textMuted: 'text-gray-500',
      bgCard: 'bg-gray-800/80',
      bgBase: 'bg-gray-900',
      borderColor: 'border-gray-700',
      strokeColor: '#9ca3af',
      gridColor: '#374151',
      tooltipBg: 'rgba(31, 41, 55, 0.95)',
      tooltipText: '#e2e8f0',
    } : {
      textPrimary: 'text-gray-800',
      textSecondary: 'text-gray-600',
      textMuted: 'text-gray-500',
      bgCard: 'bg-white/80',
      bgBase: 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100',
      borderColor: 'border-white/30',
      strokeColor: '#6b7280',
      gridColor: '#e5e7eb',
      tooltipBg: 'rgba(255, 255, 255, 0.95)',
      tooltipText: '#1f2937',
    };
  }, [isDarkMode]);

  useEffect(() => {
    if (user?.email) {
      fetchAgentData();
    }
  }, [user, timeFrame, isDarkMode]);

  const fetchAgentData = async () => {
    try {
      setLoading(true);

      const agentDocRef = doc(db, 'agents', user.email);
      const agentDocSnap = await getDoc(agentDocRef);
      const agentData = agentDocSnap.exists() ? agentDocSnap.data() as AgentStats : null;

      // Ensure moment is initialized with the correct timezone logic for comparisons
      const now = moment().tz(TARGET_TIMEZONE);
      let startDate: Date, endDate: Date;

      // All date calculations are based on the start/end of the day/week/month in TARGET_TIMEZONE
      switch (timeFrame) {
        case 'today':
          startDate = now.clone().startOf('day').toDate();
          endDate = now.clone().endOf('day').toDate();
          break;
        case 'yesterday':
          startDate = now.clone().subtract(1, 'day').startOf('day').toDate();
          endDate = now.clone().subtract(1, 'day').endOf('day').toDate();
          break;
        case 'thisWeek':
          startDate = now.clone().startOf('week').toDate();
          endDate = now.clone().endOf('week').toDate();
          break;
        case 'thisMonth':
          startDate = now.clone().startOf('month').toDate();
          endDate = now.clone().endOf('month').toDate();
          break;
        case 'lastMonth':
          startDate = now.clone().subtract(1, 'month').startOf('month').toDate();
          endDate = now.clone().subtract(1, 'month').endOf('month').toDate();
          break;
      }

      const callsQuery = query(
        collection(db, 'call_analysis'),
        where('agentEmail', '==', user.email),
        // Firestore queries must use Date objects derived from the target timezone
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate),
        orderBy('timestamp', 'desc')
      );
      const callsSnapshot = await getDocs(callsQuery);
      const callsData = callsSnapshot.docs.map(doc => doc.data() as CallAnalysis);

      // Fetch the last 7 days of daily stats for the trend/heatmap view
      const dailyStatsQuery = query(
        collection(db, 'agent_stats', user.email, 'daily_stats'),
        orderBy('date', 'desc'),
        limit(7)
      );
      const dailyStatsSnapshot = await getDocs(dailyStatsQuery);
      const dailyStatsData = dailyStatsSnapshot.docs.map(doc => doc.data() as DailyStats);
      
      const paddedDailyStats = padDailyStats(dailyStatsData);
      
      processAgentData(agentData, callsData, paddedDailyStats, timeFrame);

    } catch (error) {
      console.error('Error fetching agent data:', error);
    } finally {
      setLoading(false);
    }
  };

  const padDailyStats = (stats: DailyStats[]): DailyStats[] => {
    const padded = [];
    const today = moment().tz(TARGET_TIMEZONE).startOf('day'); 

    for (let i = 6; i >= 0; i--) {
      const date = moment(today).subtract(i, 'days').format('YYYY-MM-DD');
      const existingStat = stats.find(s => s.date === date);
      if (existingStat) {
        padded.push(existingStat);
      } else {
        padded.push({
          callCount: 0,
          totalDuration: 0,
          avgScore: 0,
          date: date,
        });
      }
    }
    return padded;
  };

  const processAgentData = (agentData: AgentStats | null, callsData: CallAnalysis[], dailyStats: DailyStats[], timeFrame: TimeFrame) => {
    const totalCalls = callsData.length;
    const totalDuration = callsData.reduce((sum, call) => sum + call.duration, 0);
    const avgScore = totalCalls > 0 ? callsData.reduce((sum, call) => sum + call.overallScore, 0) / totalCalls : 0;
    const avgHandleTime = totalCalls > 0 ? totalDuration / totalCalls : 0;

    // Use today's date in IST
    const todayIST = moment().tz(TARGET_TIMEZONE).format('YYYY-MM-DD');
    const yesterdayIST = moment().tz(TARGET_TIMEZONE).subtract(1, 'day').format('YYYY-MM-DD');
    
    // Stats calculation based on dailyStats
    const todayCalls = dailyStats.find(s => s.date === todayIST)?.callCount || 0;
    const yesterdayCalls = dailyStats.find(s => s.date === yesterdayIST)?.callCount || 0;
    const callsChange = todayCalls - yesterdayCalls;

    const updatedStats = [
      {
        title: "Today's Calls",
        value: todayCalls.toString(),
        change: callsChange >= 0 ? `+${callsChange} from yesterday` : `${callsChange} from yesterday`,
        color: isDarkMode ? 'text-blue-400' : 'text-blue-600',
        bgGradient: isDarkMode ? 'bg-gradient-to-br from-blue-900 to-blue-800' : 'bg-gradient-to-br from-blue-50 to-blue-100',
        icon: '📞'
      },
      {
        title: 'Total Calls',
        value: totalCalls.toString(),
        change: timeFrames[timeFrame],
        color: isDarkMode ? 'text-orange-400' : 'text-orange-600',
        bgGradient: isDarkMode ? 'bg-gradient-to-br from-orange-900 to-orange-800' : 'bg-gradient-to-br from-orange-50 to-orange-100',
        icon: '🎯'
      },
      {
        title: 'Avg Call Score',
        value: Math.round(avgScore).toString(),
        change: avgScore >= 70 ? 'Above target' : 'Needs improvement',
        color: isDarkMode ? 'text-green-400' : 'text-green-600',
        bgGradient: isDarkMode ? 'bg-gradient-to-br from-green-900 to-green-800' : 'bg-gradient-to-br from-green-50 to-green-100',
        icon: '📈'
      },
      {
        title: 'Avg Handle Time',
        value: `${Math.round(avgHandleTime)}s`,
        change: avgHandleTime > 300 ? 'Optimal range' : 'Short calls',
        color: isDarkMode ? 'text-purple-400' : 'text-purple-600',
        bgGradient: isDarkMode ? 'bg-gradient-to-br from-purple-900 to-purple-800' : 'bg-gradient-to-br from-purple-50 to-purple-100',
        icon: '⏱️'
      },
    ];
    setStats(updatedStats);

    // Trend Data (Last 7 Days)
    const trendData = dailyStats.map(day => {
      const date = moment(day.date);
      return {
        date: date.format('ddd'),
        calls: day.callCount,
        score: Math.round(day.avgScore || 0),
        duration: Math.round((day.totalDuration / (day.callCount || 1))) // in seconds
      };
    })
    // Sort by day of the week
    .sort((a, b) => moment(a.date).day() - moment(b.date).day()); 
    setTrendData(trendData);

    // Call Sentiment Analysis
    const sentimentCounts = callsData.reduce((acc, call) => {
      const sentiment = (call.sentiment || 'NEUTRAL').toLowerCase();
      acc[sentiment] = (acc[sentiment] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const outcomes = [
      {
        name: 'Positive',
        value: totalCalls > 0 ? Math.round((sentimentCounts['positive'] || 0) / totalCalls * 100) : 0,
        color: '#10b981'
      },
      {
        name: 'Neutral',
        value: totalCalls > 0 ? Math.round((sentimentCounts['neutral'] || 0) / totalCalls * 100) : 0,
        color: '#f59e0b'
      },
      {
        name: 'Negative',
        value: totalCalls > 0 ? Math.round((sentimentCounts['negative'] || 0) / totalCalls * 100) : 0,
        color: '#ef4444'
      },
    ];
    setCallOutcomes(outcomes);

    // Performance Metrics (Scores)
    const performanceData = totalCalls > 0 ? [
      { name: 'Structure', value: Math.round(callsData.reduce((sum, call) => sum + (call.scores?.structure || 0), 0) / totalCalls), fill: '#10b981' },
      { name: 'Clarity', value: Math.round(callsData.reduce((sum, call) => sum + (call.scores?.clarity || 0), 0) / totalCalls), fill: '#3b82f6' },
      { name: 'Confidence', value: Math.round(callsData.reduce((sum, call) => sum + (call.scores?.confidence || 0), 0) / totalCalls), fill: '#f59e0b' },
      { name: 'Closing', value: Math.round(callsData.reduce((sum, call) => sum + (call.scores?.closing || 0), 0) / totalCalls), fill: '#8b5cf6' },
    ] : [];
    setPerformanceMetrics(performanceData);

    // --- CORRECTED HOURLY DISTRIBUTION LOGIC (IST) ---
    const hourlyCounts = callsData.reduce((acc, call) => {
      const callMomentIST = moment.utc(call.timestamp.toDate()).tz(TARGET_TIMEZONE);
      const callHour = callMomentIST.hour(); 
      
      acc[callHour.toString()] = (acc[callHour.toString()] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Create a 24-hour distribution from 0 (12 AM) to 23 (11 PM)
    const allHoursDistribution = Array.from({ length: 24 }, (_, i) => {
      const hourKey = i.toString();
      const hourCalls = hourlyCounts[hourKey] || 0;
      return {
        // Use a moment object in the target timezone to correctly format the hour (hA)
        hour: moment().tz(TARGET_TIMEZONE).hour(i).minute(0).format('h A'), 
        calls: hourCalls,
      };
    });

    // To focus on the work day (e.g., 10 AM to 6 PM), we filter the array.
    // If you want a full 24-hour chart, remove the filter.
    const startTimeHour = 10; // Start at 10 AM (hour 10)
    const endTimeHour = 18; // End at 6 PM (hour 18)

    const finalHourlyData = allHoursDistribution
      // Filter to keep only hours between 10 AM and 6 PM, inclusive
      .filter((_, index) => index >= startTimeHour && index <= endTimeHour)
    
    setHourlyData(finalHourlyData);
    const heatmap = [];
    const todayForHeatmap = moment().tz(TARGET_TIMEZONE).startOf('day');

    for (let i = 6; i >= 0; i--) { 
      const date = moment(todayForHeatmap).subtract(i, 'days').format('YYYY-MM-DD');
      const calls = dailyStats.find(s => s.date === date)?.callCount || 0;
      heatmap.push({ date, calls });
    }
    setHeatmapData(heatmap);
  };

  const getHeatmapColor = (value: number) => {
    if (value === 0) return isDarkMode ? 'bg-gray-700' : 'bg-gray-200';
    // Use a maximum value of 15 for intensity to make the color difference more pronounced
    const intensity = Math.min(value / 15, 1); 
    const colors = [
      'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500', 
      'bg-blue-600', 'bg-blue-700', 'bg-blue-800', 'bg-blue-900'
    ];
    return colors[Math.floor(intensity * (colors.length - 1))];
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDarkMode
          ? 'bg-gray-900'
          : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-4 sm:p-6 lg:p-8 ${colorMode.bgBase} ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
      <div className="flex justify-between items-center mb-8">
        <div className="mb-2">
          <h1 className={`text-3xl sm:text-4xl font-bold bg-clip-text text-transparent mb-1 ${
            isDarkMode ? 'bg-gradient-to-r from-gray-200 to-gray-400' : 'bg-gradient-to-r from-gray-800 to-gray-600'
          }`}>
            Welcome back, {user.name}!
          </h1>
          <p className={colorMode.textSecondary}>Track your performance and optimize your sales strategy</p>
        </div>

        <div className="relative inline-block text-left">
          <select
            value={timeFrame}
            onChange={(e) => setTimeFrame(e.target.value as TimeFrame)}
            className={`block appearance-none w-full ${colorMode.bgCard} backdrop-blur-sm border ${colorMode.borderColor} ${colorMode.textSecondary} py-2 px-4 pr-8 rounded-xl leading-tight focus:outline-none focus:bg-white/90 focus:border-blue-500 transition-all`}
          >
            {Object.entries(timeFrames).map(([key, value]) => (
              <option key={key} value={key} className={isDarkMode ? 'bg-gray-800' : 'bg-white'}>
                {value}
              </option>
            ))}
          </select>
          <div className={`pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 ${colorMode.textSecondary}`}>
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
        {stats.map((stat, idx) => (
          <div
            key={idx}
            className={`${stat.bgGradient} rounded-2xl shadow-lg border border-white/20 p-6 backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-xl group cursor-pointer ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-2xl group-hover:scale-110 transition-transform duration-300">{stat.icon}</div>
              <div className={`text-sm font-medium px-2 py-1 rounded-full bg-white/50 ${stat.color}`}>
                Live
              </div>
            </div>
            <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-2`}>{stat.title}</h3>
            <div className={`text-3xl font-bold ${stat.color} mb-1`}>
              {stat.value}
            </div>
            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{stat.change}</p>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <div className={`flex flex-wrap gap-2 ${colorMode.bgCard} backdrop-blur-sm rounded-2xl p-2 border ${colorMode.borderColor}`}>
          {['overview', 'performance', 'activity'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 capitalize ${
                activeTab === tab
                  ? isDarkMode ? 'bg-gray-700 shadow-md text-blue-400 transform scale-105' : 'bg-white shadow-md text-blue-600 transform scale-105'
                  : isDarkMode ? 'text-gray-300 hover:text-blue-400 hover:bg-gray-700/50' : 'text-gray-600 hover:text-blue-600 hover:bg-white/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6 lg:col-span-2`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
              <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-2 sm:mb-0`}>Weekly Performance Trend</h3>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <span className={colorMode.textSecondary}>Calls</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className={colorMode.textSecondary}>Avg Score</span>
                </div>
              </div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={colorMode.gridColor} />
                  <XAxis dataKey="date" stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} axisLine={false} />
                  <YAxis stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} axisLine={false} />
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  <Area type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={3} fill="url(#callsGradient)" dot={{ fill: '#3b82f6', strokeWidth: 2, r: 5 }} name="Total Calls" />
                  <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={3} fill="url(#scoreGradient)" dot={{ fill: '#10b981', strokeWidth: 2, r: 5 }} name="Avg Score" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Call Sentiment Analysis</h3>
            <div className="h-64">
              {callOutcomes.some(outcome => outcome.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={callOutcomes}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      labelLine={false} // Add this to hide the line connecting to the label
                      label={({ name, percent }) => `${name} (${(Number(percent) * 100).toFixed(0)}%)`} // Added a basic label
                    >
                      {callOutcomes.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className={`flex items-center justify-center h-full ${colorMode.textMuted}`}>
                  No call data available for the selected time period
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {callOutcomes.map((outcome, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: outcome.color }}></div>
                  <span className={`text-sm ${colorMode.textSecondary}`}>{outcome.name}</span>
                  <span className={`text-sm font-semibold ${colorMode.textPrimary}`}>{outcome.value}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Skill Metrics</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart cx="50%" cy="50%" innerRadius="20%" outerRadius="80%" data={performanceMetrics}>
                  <RadialBar dataKey="value" cornerRadius={10} background={{ fill: isDarkMode ? '#374151' : '#e5e7eb' }} />
                  {performanceMetrics.map((entry, index) => (
                    <RadialBar key={`radial-${index}`} dataKey="value" cornerRadius={10} fill={entry.fill} startAngle={90} endAngle={90 - (entry.value / 100) * 360} />
                  ))}
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {performanceMetrics.map((metric, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: metric.fill }}></div>
                    <span className={`text-sm ${colorMode.textSecondary}`}>{metric.name}</span>
                  </div>
                  <span className={`text-sm font-semibold ${colorMode.textPrimary}`}>{metric.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Daily Score Trend (Last 7 Days)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colorMode.gridColor} />
                  <XAxis dataKey="date" stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} />
                  <YAxis stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={4} dot={{ fill: '#f59e0b', strokeWidth: 3, r: 6 }} name="Avg Score" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Avg Call Duration Trend (Last 7 Days)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="durationGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={colorMode.gridColor} />
                  <XAxis dataKey="date" stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} />
                  <YAxis tickFormatter={(tick) => `${Math.round(tick/60)}m`} stroke={colorMode.strokeColor} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  <Area type="monotone" dataKey="duration" stroke="#8b5cf6" strokeWidth={3} fill="url(#durationGradient)" dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 5 }} name="Avg Duration (sec)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Hourly Call Distribution ({timeFrames[timeFrame]})</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourlyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colorMode.gridColor} vertical={false} />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: colorMode.textSecondary, fontSize: 12 }} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={3} dot={{ stroke: '#3b82f6', strokeWidth: 2, r: 5 }} name="Total Calls" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${colorMode.bgCard} backdrop-blur-sm rounded-2xl shadow-xl border ${colorMode.borderColor} p-6`}>
            <h3 className={`text-xl font-bold ${colorMode.textPrimary} mb-6`}>Recent Activity Heatmap (Last 7 Days)</h3>
            <div className="grid grid-cols-7 gap-1">
              {heatmapData.map((day, index) => (
                <div
                  key={index}
                  title={`${moment(day.date).format('MMM D')}: ${day.calls} calls`}
                  className={`${getHeatmapColor(day.calls)} h-12 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-md flex items-center justify-center text-sm ${isDarkMode && day.calls === 0 ? 'text-gray-400' : 'text-white'} font-bold`}
                >
                  {day.calls > 0 ? day.calls : ''}
                </div>
              ))}
            </div>
            <div className={`mt-4 flex justify-between text-xs ${colorMode.textMuted}`}>
              <span>{moment().subtract(6, 'days').format('MMM D')}</span>
              <span>{moment().format('MMM D')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}