import React, { useState, useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { format, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Sector } from 'recharts';
import { Calendar, PieChartIcon, Phone, Clock, Award, MapPin, Globe, Smile, Activity, Users, Zap, Volume2, Store, Globe as GlobeIcon, PhoneOutgoing, PhoneOff } from 'lucide-react'; 

import { User } from "../../types";

interface ManagerDashboardProps {
 user: User;
 isDarkMode: boolean;
}

interface Agent {
 id: string;
 name: string;
 email: string;
 phone: string;
 agentType: "store" | "online";
 stats: {
  totalCalls: number;
  overallScore: number;
  lastCallDate: any;
  updatedAt: any;
 };
}

interface CallAnalysis {
 callId: string;
 agentId: string;
 agentName: string;
 timestamp: any;
 duration: number;
 overallScore: number;
 sentiment: string;
 language: string;
 talkRatio: string;
 type_of_call?: string; // Included to identify C2C vs INCOMING
 
 callType?: {
  primary: string;
  subCategory: string;
  confidence: number;
  secondary: string[];
 };
 
 metadata: {
  circle?: string;
  network?: string;
 };
}

interface CallVolumeStats {
  totalCallsReceived: number;
  totalCallsAnswered: number;
  dailyStats: {
    [date: string]: {
      callsReceived: number;
      callsAnswered: number;
      offHoursCalls?: number;
      type_distribution?: {
        online?: { received?: number; answered?: number };
        store?: { received?: number; answered?: number };
      };
    };
  };
  hourlyDistribution: {
    [hour: string]: {
      received: number;
      answered: number;
    };
  };
  peakHours: {
    daily: {
      [date: string]: string;
    };
  };
  type_distribution?: {
    online?: { received?: number; answered?: number; };
    store?: { received?: number; answered?: number; };
  };
}

interface DashboardStats {
  totalCallsReceived: number;
  totalCallsAnswered: number;
  callsOffHours: number;
  callsAnsweredOnline: number;
  callsAnsweredStore: number;
  callsReceivedOnline: number;
  callsReceivedStore: number;
  totalCallsAttendedInPeriod: number;
  callsAnsweredC2C: number;
  callsMadeC2C: number;
  callsFailed: number; // 🆕 Added Calls Failed
}

const VIBRANT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6EE7B7', '#A78BFA', '#F472B6', '#14B8A6'];
const SENTIMENT_COLORS = {
 'Positive': '#2ECC71',
 'Negative': '#E74C3C',
 'Neutral': '#F39C12'
};

const CustomTooltip = ({ active, payload, label, isDarkMode }: any) => {
 if (active && payload && payload.length) {
  const data = payload[0].payload;
  return (
   <div className={`p-4 bg-white dark:bg-gray-700 shadow-lg rounded-lg border border-gray-200 dark:border-gray-600`}>
    <p className="font-bold text-lg mb-1 dark:text-white">
     {data.name || data.circle || data.network || data.language || data.range || data.sentiment || data.date || data.callType}
    </p>
    {payload.map((p: any, index: number) => (
     <p key={index} style={{ color: p.color }} className="font-semibold text-sm">
      {`${p.name}: ${p.value}`}
     </p>
    ))}
   </div>
  );
 }
 return null;
};

const CustomCell: React.FC<any> = (props) => {
  const {
    fill,
    cx,
    cy,
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
    payload, 
    percent,
    value,
    index,
    activeIndex,
    isDarkMode,
  } = props;

  const cellFill = fill || VIBRANT_COLORS[index % VIBRANT_COLORS.length];

  if (!payload) {
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={cellFill}
        stroke={isDarkMode ? '#1e293b' : '#ffffff'}
        strokeWidth={2}
      />
    );
  }

  const isActive = index === activeIndex;
  const newOuterRadius = isActive ? outerRadius + 8 : outerRadius;
  const mainTextColor = isDarkMode ? '#f8fafc' : '#1e293b';
  const subTextColor = isDarkMode ? '#cbd5e1' : '#64748b';

  if (isActive) {
    return (
      <g>
        <text
          x={cx}
          y={cy}
          dy={-10}
          textAnchor="middle"
          fill={mainTextColor}
          className="text-lg font-bold"
        >
          {payload.name}
        </text>
        <text
          x={cx}
          y={cy}
          dy={15}
          textAnchor="middle"
          fill={subTextColor}
          className="text-sm"
        >
          {`${value} calls ${(percent * 100).toFixed(1)}%)`}
        </text>

        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={newOuterRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={cellFill} 
          stroke={isDarkMode ? '#1e293b' : '#ffffff'}
          strokeWidth={3}
        />
      </g>
    );
  }

  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={cellFill}
      stroke={isDarkMode ? '#1e293b' : '#ffffff'}
      strokeWidth={2}
    />
  );
};

const CallTypeDonutChart: React.FC<{ data: any[]; isDarkMode: boolean }> = ({ data, isDarkMode }) => {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(undefined);
  };

  const renderCustomizedLabel = ({
    cx, cy, midAngle, innerRadius, outerRadius, percent, name
  }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null;

    return (
      <text 
        x={x} 
        y={y} 
        fill={isDarkMode ? '#f8fafc' : '#1e293b'} 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="text-xs font-medium"
      >
        {`${name} (${(percent * 100).toFixed(0)}%)`}
      </text>
    );
  };

  const totalCalls = data.reduce((sum: number, item: any) => sum + item.value, 0);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Phone size={48} className={`mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
        <p className={`text-lg font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          No call type data
        </p>
        <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          Try adjusting your date range
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            onMouseEnter={onPieEnter}
            onMouseLeave={onPieLeave}
            label={renderCustomizedLabel}
            labelLine={false}
          >
            {data.map((entry: any, index: number) => (
              <Cell 
                key={`cell-${index}`} 
                fill={VIBRANT_COLORS[index % VIBRANT_COLORS.length]}
                stroke={isDarkMode ? '#1e293b' : '#ffffff'}
                strokeWidth={index === activeIndex ? 3 : 1}
              />
            ))}
          </Pie>
          <Tooltip 
            content={({ active, payload }: any) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                if (!data) return null;

                const percentage = totalCalls > 0 ? ((data.value / totalCalls) * 100).toFixed(1) : 0;
                
                return (
                  <div className={`p-4 rounded-lg shadow-lg border ${
                    isDarkMode 
                      ? 'bg-gray-800 border-gray-700' 
                      : 'bg-white border-gray-200'
                  }`}>
                    <p className={`font-bold text-lg mb-2 ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {data.name}
                    </p>
                    <div className="space-y-1">
                      <p className={`text-sm ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        Calls: <span className="font-semibold">{data.value}</span>
                      </p>
                      <p className={`text-sm ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        Percentage: <span className="font-semibold">{percentage}%</span>
                      </p>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ user, isDarkMode }) => {
 const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
  start: startOfDay(new Date()),
  end: endOfDay(new Date())
 });
 const [stats, setStats] = useState<DashboardStats>({
    totalCallsReceived: 0,
    totalCallsAnswered: 0,
    callsOffHours: 0,
    callsAnsweredOnline: 0,
    callsAnsweredStore: 0,
    callsReceivedOnline: 0,  
    callsReceivedStore: 0,   
    totalCallsAttendedInPeriod: 0,
    callsAnsweredC2C: 0,     
    callsMadeC2C: 0,         
    callsFailed: 0, // 🆕 initialized
  });
 const [callVolumeData, setCallVolumeData] = useState<any[]>([]);
 const [circleData, setCircleData] = useState<any[]>([]);
 const [networkData, setNetworkData] = useState<any[]>([]);
 const [languageData, setLanguageData] = useState<any[]>([]);
 const [durationData, setDurationData] = useState<any[]>([]);
 const [sentimentData, setSentimentData] = useState<any[]>([]);
 const [talkRatioData, setTalkRatioData] = useState<any[]>([]); 
 const [leaderboard, setLeaderboard] = useState<Agent[]>([]);
 const [loading, setLoading] = useState(true);
 const [callTypeData, setCallTypeData] = useState<any[]>([]);

 useEffect(() => {
  fetchDashboardData();
 }, [dateRange]);

 const fetchCallTypeData = async () => {
  try {
    const callsQuery = query(
      collection(db, 'call_analysis'),
      where('timestamp', '>=', dateRange.start),
      where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const callTypeCounts: { [key: string]: number } = {};
        
    callsSnapshot.forEach(doc => {
      const callData = doc.data() as CallAnalysis;
          
      let callType = 'Unknown';
      
      if (callData.callType?.primary) {
        callType = callData.callType.primary;
      }
      
      if (callType && callType !== 'Unknown') {
        callTypeCounts[callType] = (callTypeCounts[callType] || 0) + 1;
      }
      
    });
        
    const data = Object.entries(callTypeCounts)
      .map(([callType, count]) => ({
        name: callType,
        value: count,
        count: count
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
    
    setCallTypeData(data);
  } catch (error) {
    console.error('Error fetching call type data:', error);
    setCallTypeData([]);
  }
 };

 const fetchC2CStats = async () => {
    try {
      const callsQuery = query(
        collection(db, 'call_analysis'),
        where('timestamp', '>=', dateRange.start),
        where('timestamp', '<=', dateRange.end)
      );
      const callsSnapshot = await getDocs(callsQuery);
      
      let answeredC2C = 0;
      callsSnapshot.forEach(doc => {
        if (doc.data().type_of_call === 'C2C') {
          answeredC2C++;
        }
      });

      const daysInRange = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
      let missedC2C = 0;

      await Promise.all(daysInRange.map(async (day) => {
        const dateStr = format(day, 'dd-MM-yyyy'); 
        const docSnap = await getDoc(doc(db, 'missed_calls', dateStr));
        if (docSnap.exists()) {
           const data = docSnap.data();
           const calls = data.calls || [];
           missedC2C += calls.filter((c: any) => c.source === 'C2C').length;
        }
      }));

      setStats(prev => ({
        ...prev,
        callsAnsweredC2C: answeredC2C,
        callsMadeC2C: answeredC2C + missedC2C
      }));

    } catch (error) {
      console.error('Error fetching C2C stats:', error);
    }
  };

 const fetchDashboardData = async () => {
  setLoading(true);
  try {
   await Promise.all([
    fetchOverviewStats().catch(error => console.error('Overview stats error:', error)),
    fetchC2CStats().catch(error => console.error('C2C stats error:', error)),
    fetchCallVolumeData().catch(error => console.error('Call volume error:', error)),
    fetchCircleData().catch(error => console.error('Circle data error:', error)),
    fetchNetworkData().catch(error => console.error('Network data error:', error)),
    fetchLanguageData().catch(error => console.error('Language data error:', error)),
    fetchDurationData().catch(error => console.error('Duration data error:', error)),
    fetchSentimentData().catch(error => console.error('Sentiment data error:', error)),
    fetchTalkRatioData().catch(error => console.error('Talk ratio error:', error)),
    fetchCallTypeData().catch(error => console.error('Call type error:', error)), 
    fetchLeaderboard().catch(error => console.error('Leaderboard error:', error))
   ]);
  } catch (error) {
   console.error('Error fetching dashboard data:', error);
  } finally {
   setLoading(false);
  }
 };

 const fetchOverviewStats = async () => {
  try {
    const statsDoc = await getDoc(doc(db, 'call_volume_stats', 'overall'));

    let totalReceived = 0;
    let totalAnswered = 0;
    let totalOffHoursCalls = 0;

    let callsAnsweredOnline = 0;
    let callsAnsweredStore = 0;
    let callsReceivedOnline = 0;
    let callsReceivedStore = 0;
    let totalCallsAttendedInPeriod = 0;

    if (statsDoc.exists()) {
      const volumeStats = statsDoc.data() as CallVolumeStats;

      const today = startOfDay(new Date());
      const isToday =
        startOfDay(dateRange.start).getTime() === today.getTime() &&
        endOfDay(dateRange.end).getTime() === endOfDay(today).getTime();

      if (isToday) {
        const todayKey = format(new Date(), 'yyyy-MM-dd');
        const todayStats = volumeStats.dailyStats?.[todayKey];

        if (todayStats) {
          totalReceived = todayStats.callsReceived || 0;
          totalAnswered = todayStats.callsAnswered || 0;
          totalOffHoursCalls = todayStats.offHoursCalls || 0;

          const td = todayStats.type_distribution;
          if (td) {
            callsAnsweredOnline = td.online?.answered ?? 0;
            callsReceivedOnline = td.online?.received ?? 0;
            callsAnsweredStore = td.store?.answered ?? 0;
            callsReceivedStore = td.store?.received ?? 0;
          }
        }
      } else {
        const daysInRange = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });

        let rangeOnline = { received: 0, answered: 0 };
        let rangeStore = { received: 0, answered: 0 };

        daysInRange.forEach(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayStats = volumeStats.dailyStats?.[dateKey];
          if (dayStats) {
            totalReceived += dayStats.callsReceived || 0;
            totalAnswered += dayStats.callsAnswered || 0;
            totalOffHoursCalls += dayStats.offHoursCalls || 0;

            const td = dayStats.type_distribution;
            if (td) {
              rangeOnline.received += td.online?.received ?? 0;
              rangeOnline.answered += td.online?.answered ?? 0;
              rangeStore.received += td.store?.received ?? 0;
              rangeStore.answered += td.store?.answered ?? 0;
            }
          }
        });

        callsAnsweredOnline = rangeOnline.answered;
        callsReceivedOnline = rangeOnline.received;
        callsAnsweredStore = rangeStore.answered;
        callsReceivedStore = rangeStore.received;
      }
    }

    totalCallsAttendedInPeriod = callsAnsweredOnline + callsAnsweredStore;

    // 🆕 Calculate Calls Failed
    const calculatedCallsFailed = Math.max(0, totalReceived - totalOffHoursCalls - (callsReceivedOnline + callsReceivedStore));

    setStats(prev => ({
      ...prev,
      totalCallsReceived: totalReceived,
      totalCallsAnswered: totalCallsAttendedInPeriod,
      callsOffHours: totalOffHoursCalls,
      callsAnsweredOnline,
      callsAnsweredStore,
      callsReceivedOnline,
      callsReceivedStore,
      totalCallsAttendedInPeriod,
      callsFailed: calculatedCallsFailed, 
    }));

  } catch (error) {
    console.error('Error fetching overview stats:', error);
  }
};

 const fetchCallVolumeData = async () => {
  try {
    const statsDoc = await getDoc(doc(db, 'call_volume_stats', 'overall'));
    if (statsDoc.exists()) {
      const volumeStats = statsDoc.data() as CallVolumeStats;
      const data: any[] = [];

      const daysInRange = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
      daysInRange.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const dateLabel = format(day, 'MMM dd');
        
        const dailyStats = volumeStats.dailyStats?.[dateKey];
        data.push({
          date: dateLabel,
          'Calls Received': dailyStats?.callsReceived || 0,
          'Calls Answered': dailyStats?.callsAnswered || 0,
        });
      });

      setCallVolumeData(data);
    }
  } catch (error) {
    console.error('Error fetching call volume data:', error);
  }
 };

 const fetchCircleData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const circleCounts: { [key: string]: number } = {};
    
    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    const circle = callData.metadata?.circle || 'Unknown';
    circleCounts[circle] = (circleCounts[circle] || 0) + 1;
    });
    
    const data = Object.entries(circleCounts)
    .map(([circle, count]) => ({
      name: circle,
      count
    }))
    .filter(item => item.count > 0); 
    
    setCircleData(data);
  } catch (error) {
    console.error('Error fetching circle data:', error);
    setCircleData([]);
  }
 };

 const fetchNetworkData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const networkCounts: { [key: string]: number } = {};
    
    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    const network = callData.metadata?.network || 'Unknown';
    networkCounts[network] = (networkCounts[network] || 0) + 1;
    });
    
    const data = Object.entries(networkCounts)
    .map(([network, count]) => ({
      network,
      count
    }))
    .filter(item => item.count > 0); 
    
    setNetworkData(data);
  } catch (error) {
    console.error('Error fetching network data:', error);
    setNetworkData([]);
  }
 };

 const fetchLanguageData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const languageCounts: { [key: string]: number } = {};
    
    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    const language = callData.language || 'Unknown';
    languageCounts[language] = (languageCounts[language] || 0) + 1;
    });
    
    const data = Object.entries(languageCounts)
    .map(([language, count]) => ({
      language,
      count
    }))
    .filter(item => item.count > 0); 
    
    setLanguageData(data);
  } catch (error) {
    console.error('Error fetching language data:', error);
    setLanguageData([]);
  }
 };

 const fetchDurationData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const durationRanges = [
    { range: '0-1 min', min: 0, max: 60, count: 0 },
    { range: '1-3 min', min: 61, max: 180, count: 0 },
    { range: '3-5 min', min: 181, max: 300, count: 0 },
    { range: '5-10 min', min: 301, max: 600, count: 0 },
    { range: '10+ min', min: 601, max: Infinity, count: 0 }
    ];
    
    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    const duration = callData.duration;
    for (const range of durationRanges) {
      if (duration >= range.min && duration <= range.max) {
      range.count++;
      break;
      }
    }
    });
    
    const filteredData = durationRanges.filter(range => range.count > 0);
    setDurationData(filteredData);
  } catch (error) {
    console.error('Error fetching duration data:', error);
    setDurationData([]);
  }
 };

 const fetchSentimentData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const sentimentCounts: { [key: string]: number } = {
    Positive: 0,
    Negative: 0,
    Neutral: 0
    };
    
    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    const sentiment = callData.sentiment?.toLowerCase() || 'neutral';
    const sentimentKey = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
    
    if (sentimentCounts.hasOwnProperty(sentimentKey)) {
      sentimentCounts[sentimentKey as keyof typeof sentimentCounts]++;
    } else {
      sentimentCounts.Neutral++;
    }
    });
    
    const data = Object.entries(sentimentCounts)
    .map(([sentiment, count]) => ({
      sentiment,
      count
    }))
    .filter(item => item.count > 0); 
    
    setSentimentData(data);
  } catch (error) {
    console.error('Error fetching sentiment data:', error);
    setSentimentData([]);
  }
 };

 const fetchTalkRatioData = async () => {
  try {
    const callsQuery = query(
    collection(db, 'call_analysis'),
    where('timestamp', '>=', dateRange.start),
    where('timestamp', '<=', dateRange.end)
    );
    const callsSnapshot = await getDocs(callsQuery);
    const talkRatioCounts = {
    'Agent-Dominant': 0,
    'Customer-Dominant': 0,
    'Balanced': 0,
    };

    callsSnapshot.forEach(doc => {
    const callData = doc.data() as CallAnalysis;
    if (callData.talkRatio) {
      const [customerRatio, agentRatio] = callData.talkRatio.split(':').map(Number);
      if (agentRatio > customerRatio * 1.2) {
      talkRatioCounts['Agent-Dominant']++;
      } else if (customerRatio > agentRatio * 1.2) {
      talkRatioCounts['Customer-Dominant']++;
      } else {
      talkRatioCounts['Balanced']++;
      }
    }
    });
    
    const data = Object.entries(talkRatioCounts)
    .map(([ratioType, count]) => ({
      name: ratioType,
      value: count
    }))
    .filter(item => item.value > 0);
    
    setTalkRatioData(data);
  } catch (error) {
    console.error('Error fetching talk ratio data:', error);
    setTalkRatioData([]);
  }
 };

 const fetchLeaderboard = async () => {
  try {
    const agentsQuery = query(
    collection(db, 'agents'),
    orderBy('stats.overallScore', 'desc'),
    limit(5)
    );
    const agentsSnapshot = await getDocs(agentsQuery);
    const agents: Agent[] = [];
    agentsSnapshot.forEach(doc => {
    agents.push({ id: doc.id, ...doc.data() } as Agent);
    });
    setLeaderboard(agents);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
  }
 };

 const handleDateRangeChange = (start: Date, end: Date) => {
  const startOfDayDate = startOfDay(start);
  const endOfDayDate = endOfDay(end);
  setDateRange({ start: startOfDayDate, end: endOfDayDate });
 };

 const getChartColors = (isDarkMode: boolean) => ({
  stroke: isDarkMode ? '#e2e8f0' : '#6b7280',
  grid: isDarkMode ? '#475569' : '#e5e7eb',
  tooltipBg: isDarkMode ? '#1f2937' : 'rgba(255, 255, 255, 0.95)',
  tooltipText: isDarkMode ? '#e2e8f0' : '#1f2937'
 });

 const chartColors = getChartColors(isDarkMode);

 if (loading) {
  return (
    <div className={`min-h-screen flex items-center justify-center ${isDarkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-purple-600 via-blue-600 to-teal-600'}`}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-4 border-white mb-4"></div>
        <p className="text-white text-xl font-semibold">Loading Dashboard...</p>
      </div>
    </div>
  );
 }

 const hasData =
  callVolumeData.length > 0 ||
  circleData.length > 0 ||
  networkData.length > 0 ||
  languageData.length > 0 ||
  durationData.length > 0 ||
  sentimentData.length > 0 ||
  talkRatioData.length > 0 ||
  callTypeData.length > 0 || 
  leaderboard.length > 0;

  const answerRateSubtitle = stats.totalCallsReceived > 0 
    ? `${((stats.totalCallsAttendedInPeriod / stats.totalCallsReceived) * 100).toFixed(1)}% answer rate`
    : '0% answer rate';

 return (
  <div className={`min-h-screen p-4 sm:p-6 ${isDarkMode ? 'bg-gray-900 text-gray-100' : 'bg-gradient-to-br from-purple-50 via-blue-50 to-teal-50'}`}>
    {/* Animated Background */}
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className={`absolute -top-40 -right-40 w-80 h-80 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse ${isDarkMode ? 'bg-purple-700' : 'bg-purple-300'}`}></div>
      <div className={`absolute -bottom-40 -left-40 w-80 h-80 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse ${isDarkMode ? 'bg-blue-700' : 'bg-blue-300'}`}></div>
      <div className={`absolute top-40 left-40 w-80 h-80 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse ${isDarkMode ? 'bg-teal-700' : 'bg-teal-300'}`}></div>
    </div>

    <div className="relative z-10 mx-auto max-w-7xl">
      {/* Header and Date Range Picker */}
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-start md:justify-between">
        <div className="mb-4 md:mb-0 text-center md:text-left">
          <h1 className={`text-3xl sm:text-4xl lg:text-5xl font-bold bg-clip-text text-transparent mb-2 ${isDarkMode ? 'bg-gradient-to-r from-purple-400 via-blue-400 to-teal-400' : 'bg-gradient-to-r from-purple-600 via-blue-600 to-teal-600'}`}>
            Manager Dashboard
          </h1>
          <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} text-sm lg:text-lg`}>Real-time call center analytics and performance insights</p>
        </div>
        
       <div className={`rounded-xl shadow-lg p-4 flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-3 shrink-0 w-full md:w-auto ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="relative flex items-center">
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
                      // Prevent future date: revert to previous valid date
                      e.target.value = format(dateRange.start, 'dd-MM-yyyy');
                    } else {
                      handleDateRangeChange(startOfDay(parsed), dateRange.end);
                    }
                  }
                } else {
                  // Revert if the format is completely invalid
                  e.target.value = format(dateRange.start, 'dd-MM-yyyy');
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className={`border-2 rounded-lg px-3 py-2 pr-10 focus:border-purple-500 focus:outline-none w-36 ${isDarkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-purple-200'}`}
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 overflow-hidden cursor-pointer">
              <Calendar size={20} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              <input
                type="date"
                max={format(new Date(), 'yyyy-MM-dd')} // Disables future dates in the pop-up
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

          <span className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>to</span>

          {/* End Date */}
          <div className="relative flex items-center">
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
                      // Prevent future date: revert to previous valid date
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
              className={`border-2 rounded-lg px-3 py-2 pr-10 focus:border-purple-500 focus:outline-none w-36 ${isDarkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-purple-200'}`}
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 overflow-hidden cursor-pointer">
              <Calendar size={20} className={`absolute pointer-events-none top-0 left-0 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              <input
                type="date"
                max={format(new Date(), 'yyyy-MM-dd')} // Disables future dates in the pop-up
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
      </div>

      {/* Stats Cards - Updated Grid to hold 6 evenly */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard
          icon={<Phone size={20} />}
          title="Incoming Calls"
          value={stats.totalCallsReceived.toLocaleString()}
          subtitle={answerRateSubtitle}
          gradient="bg-gradient-to-r from-blue-500 to-blue-600"
          iconBg="bg-blue-400"
          isDarkMode={isDarkMode}
        />
        <StatCard
          icon={<GlobeIcon size={20} />}
          title="Online Calls"
          value={stats.callsAnsweredOnline.toLocaleString()}
          subtitle={`Of ${stats.callsReceivedOnline.toLocaleString()} Received`} 
          gradient="bg-gradient-to-r from-teal-500 to-teal-600"
          iconBg="bg-teal-400"
          isDarkMode={isDarkMode}
        />
        <StatCard
          icon={<Store size={20} />}
          title="Store Calls"
          value={stats.callsAnsweredStore.toLocaleString()}
          subtitle={`Of ${stats.callsReceivedStore.toLocaleString()} Received`} 
          gradient="bg-gradient-to-r from-indigo-500 to-indigo-600"
          iconBg="bg-indigo-400"
          isDarkMode={isDarkMode}
        />
        
        {/* Outgoing (C2C) Calls */}
        <StatCard
          icon={<PhoneOutgoing size={20} />}
          title="C2C Outgoing"
          value={stats.callsAnsweredC2C.toLocaleString()}
          subtitle={`Of ${stats.callsMadeC2C.toLocaleString()} Made`} 
          gradient="bg-gradient-to-r from-cyan-500 to-cyan-600"
          iconBg="bg-cyan-400"
          isDarkMode={isDarkMode}
        />

        {/* Off-Hours Calls */}
        <StatCard
          icon={<Clock size={20} />}
          title="Off-Hours"
          value={stats.callsOffHours.toLocaleString()}
          subtitle="<10am or >7pm"
          gradient="bg-gradient-to-r from-orange-500 to-red-500"
          iconBg="bg-orange-400"
          isDarkMode={isDarkMode}
        />
        
        {/* 🆕 NEW CARD: Calls Failed */}
        <StatCard
          icon={<PhoneOff size={20} />}
          title="Calls Failed"
          value={stats.callsFailed.toLocaleString()}
          subtitle="Missed/Failed"
          gradient="bg-gradient-to-r from-red-500 to-rose-600"
          iconBg="bg-red-400"
          isDarkMode={isDarkMode}
        />
      </div>

      {!hasData ? (
        <div className={`rounded-3xl shadow-2xl p-16 text-center backdrop-blur-sm border ${
        isDarkMode
          ? 'bg-gray-800/50 border-gray-700'
          : 'bg-white/70 border-white'
        }`}>
          <div className="mb-6">
            <PieChartIcon className={`w-24 h-24 mx-auto ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
          </div>
          <h3 className={`text-3xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            No Data Available
          </h3>
          <p className={`text-xl ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            No calls found for the selected filters. Try adjusting your date range.
          </p>
        </div>
      ) : (
        <>
        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          {/* Call Volume Trends - Bar Chart */}
          <div className="lg:col-span-2">
            <div className={`rounded-xl shadow-lg p-6 h-full ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                <Activity size={24} className="mr-2 text-blue-600" />
                Call Volume Trends
              </h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={callVolumeData} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis dataKey="date" stroke={chartColors.stroke} />
                  <YAxis stroke={chartColors.stroke} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                  <Legend />
                  <Bar dataKey="Calls Received" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Calls Answered" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agent Performance Leaderboard */}
          <div className="lg:col-span-2">
            <div className={`rounded-xl shadow-lg p-6 h-full ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                <Award size={24} className="mr-2 text-yellow-600" />
                Top Performers
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {leaderboard.map((agent, index) => (
                  <div key={agent.id} className={`flex items-center justify-between p-4 rounded-lg hover:from-blue-50 hover:to-blue-100 transition-all duration-300 transform hover:scale-102 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gradient-to-r from-gray-50 to-gray-100'}`}>
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold mr-4 shadow-lg ${
                      index === 0 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
                      index === 1 ? 'bg-gradient-to-r from-gray-400 to-gray-600' :
                      index === 2 ? 'bg-gradient-to-r from-orange-400 to-orange-600' :
                      'bg-gradient-to-r from-blue-400 to-blue-600'
                      }`}>
                      {index + 1}
                      </div>
                      <div>
                        <p className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{agent.name}</p>
                        <p className={`text-sm flex items-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <Users size={14} className="mr-1" />
                          {agent.stats.totalCalls} calls
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-2xl bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                        {agent.stats.overallScore.toFixed(1)}
                      </p>
                      <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>score</p>
                    </div>
                  </div>
                ))}
                {leaderboard.length === 0 && (
                  <div className="text-center py-8">
                    <Users size={48} className="mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-500 text-lg">No agent data available</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Charts Grid - 3x2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Circle Distribution */}
          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <MapPin size={24} className="mr-2 text-purple-600" />
              Circle Distribution
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={circleData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ name, count }) => `${name} (${count})`}
                  labelLine={false}
                >
                  {circleData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={VIBRANT_COLORS[index % VIBRANT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Phone size={24} className="mr-2 text-indigo-600" />
              Call Type Distribution
            </h3>
            <CallTypeDonutChart data={callTypeData} isDarkMode={isDarkMode} />
          </div>

          {/* Language Distribution */}
          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Globe size={24} className="mr-2 text-blue-600" />
              Language Distribution
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={languageData}
                  dataKey="count"
                  nameKey="language"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ language, count }) => `${language} (${count})`}
                  labelLine={false}
                >
                  {languageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={VIBRANT_COLORS[index % VIBRANT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Call Duration Distribution */}
          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Clock size={24} className="mr-2 text-orange-600" />
              Call Duration Distribution
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={durationData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="range" stroke={chartColors.stroke} />
                <YAxis stroke={chartColors.stroke} allowDecimals={false} />
                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {durationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={VIBRANT_COLORS[index % VIBRANT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sentiment Analysis */}
          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Smile size={24} className="mr-2 text-green-600" />
              Sentiment Analysis
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={sentimentData}
                  dataKey="count"
                  nameKey="sentiment"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ sentiment, count }) => `${sentiment} (${count})`}
                  labelLine={false}
                >
                  {sentimentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={SENTIMENT_COLORS[entry.sentiment as keyof typeof SENTIMENT_COLORS] || '#95A5A6'} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Talk Ratio Distribution */}
          <div className={`rounded-xl shadow-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-xl font-bold mb-4 flex items-center ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
              <Volume2 size={24} className="mr-2 text-pink-600" />
              Talk Ratio Distribution
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={talkRatioData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="name" stroke={chartColors.stroke} />
                <YAxis stroke={chartColors.stroke} allowDecimals={false} />
                <Tooltip content={<CustomTooltip isDarkMode={isDarkMode} />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {talkRatioData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={VIBRANT_COLORS[index % VIBRANT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {/* Footer */}
        <div className="text-center mt-12 pb-8">
          <div className={`rounded-xl shadow-lg p-6 inline-block ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <p className={`mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Dashboard last updated: {new Date().toLocaleString()}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-4 text-sm text-gray-500">
              <span className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
                Live Data
              </span>
              <span className="flex items-center">
                <Activity size={16} className="mr-1" />
                Real-time Analytics
              </span>
              <span className="flex items-center">
                <Zap size={16} className="mr-1" />
                Auto-refresh
              </span>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  </div>
 );
};

const StatCard = ({
 icon,
 title,
 value,
 subtitle,
 gradient,
 iconBg,
 isDarkMode,
 valueClassName
}: {
 icon: React.ReactNode;
 title: string;
 value: string | number;
 subtitle?: string;
 gradient: string;
 iconBg: string;
 isDarkMode: boolean;
 valueClassName?: string;
}) => (
 <div className={`${gradient} rounded-xl shadow-lg p-3 text-white transform hover:scale-105 transition-all duration-300 h-full`}>
  <div className="flex flex-col h-full">
    <div className="flex items-center mb-1">
      <div className={`p-1.5 rounded-full ${iconBg} mr-2 shadow-lg flex-shrink-0`}>
        {icon}
      </div>
      <p className="text-xs font-medium opacity-90 leading-tight">{title}</p>
    </div>
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <p className={`font-bold ${valueClassName || 'text-xl sm:text-2xl'} leading-tight`}>{value}</p>
      {subtitle && <p className="text-xs opacity-75 mt-0.5 leading-tight">{subtitle}</p>}
    </div>
  </div>
 </div>
);

export default ManagerDashboard;