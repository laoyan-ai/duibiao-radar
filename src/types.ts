import type {CollectionScope} from './collection-scope.js';
import type {ProviderConfig} from './providers.js';
export type Metric = {raw:string|null; value:number|null; approximate:boolean};
export type Frame = {id:string; file:string; targetTime:number; actualTime:number; width:number; height:number; duplicateOf?:string};
export type Claim = {value:string; evidence:string[]; confidence:'high'|'medium'|'low'; explanation:string};
export type Analysis = {theme:Claim; audience:Claim; hook:Claim; structure:Claim; orientation:Claim; person:Claim; mainVisual:Claim; layout:Claim; source:Claim; takeaways:Claim; needsMoreFrames:boolean; limitations:string[]};
export type Video = {id:string; url:string; authorId:string; authorName:string; authorUrl:string; title:string; description:string; dateText:string; publishedAt:string|null; duration:number|null; likes:Metric; favorites:Metric; shares:Metric; kind:'video'|'image'|'unknown'; related:boolean; collectedAt:string; frames:Frame[]; analysis?:Analysis; analysisStatus?:string; samplingError?:string; samplingComplete?:boolean; analysisError?:string; analysisCalls?:number; usage?:unknown; manualNote?:string; rankingSnapshot?:Pick<Video,'likes'|'title'|'dateText'|'publishedAt'|'kind'>; width?:number; height?:number};
export type Author = {identity?:'account'|'nickname'|'truncated';id:string; name:string; url:string; coverage:'complete'|'partial'; reason:string; fetchedCount:number;cardsCollected?:boolean;selectionComplete?:boolean;selectionReasons?:string[];bio?:string;profileCollected?:boolean;profileName?:string;profileSampleIds?:string[];sourceSorts?:string[];relevance?:SemanticAssessment;relevanceCacheKey?:string;relevanceCalls?:number;relevanceUsage?:unknown;relevanceError?:string};
export type RankedAuthor = {authorId:string; score:number; likes:number; favorites:number; shares:number; videoIds:string[]; eligible:boolean; reasons:string[]; rank:number};
export type TaskStatus = 'idle'|'searching'|'collecting'|'sampling'|'analyzing'|'stopping'|'waiting_user'|'waiting_api'|'ready_analysis'|'paused'|'partial'|'complete'|'cancelled'|'failed';
export type Limits = {searchPerSort:number; maxSearchVideos:number; maxAuthors:number; profileMax:number;policy?:'dual50'|'combined50'|'raw50'};
export type SemanticAssessment={profileScore:number|null;videos:{id:string;score:number;reason:string}[];reason:string};
export type CandidateScore={authorId:string;rank:number;relevanceScore:number|null;likesScore:number|null;compositeScore:number|null;meanLikes:number|null;totalLikes:number|null;maxLikes:number|null;sampleCount:number;knownLikesCount:number;videoIds:string[];reason:string;warnings:string[];excluded?:boolean;selected?:boolean};
export type ResearchOptions = {authorCount:number;videosPerAuthor:number;days:number};
export type TaskProgress={completed?:number;total?:number;unit?:string};
export type SearchCheckpoint={version:1;searchLimit?:number;policy?:'dual50'|'combined50'|'raw50';keyword:string;videos:Video[];authors:Author[];lanes:{likes:{seenIds:string[];done:boolean};combined:{seenIds:string[];done:boolean}};reason:string};
export type ResearchTask = {collectionScope?:CollectionScope;analysisConfig?:ProviderConfig;id:string; keyword:string; createdAt:string; cutoff:string; status:TaskStatus; phase:string; progress?:TaskProgress; runStartedAt?:string; message:string; mode:'engagement'|'likes'; options?:ResearchOptions; collectionVersion?:number;rankingOnly?:boolean;rankingRequested?:boolean;profileRanking?:boolean;searchVideoIds?:string[]; candidateScores?:CandidateScore[]; selectionLocked?:boolean; limits:Limits; videos:Video[]; authors:Author[]; ranking:RankedAuthor[]; excludedAuthorIds:string[]; selectedVideoIds:string[]; errors:string[]; events:{at:string;message:string}[]; summary?:string; summaryUsage?:unknown; summaryCalls?:number; summaryHistory?:{summary?:string;usage?:unknown;calls:number;selectedVideoIds:string[];invalidatedAt:string}[]; searchDone:boolean;searchCheckpoint?:SearchCheckpoint; totalFrames:number; updatedAt:string};
export type SearchResult = {videos:Video[]; authors:Author[]; reason:string;complete?:boolean};
export type ProfileResult = {videos:Video[]; coverage:'complete'|'partial'; reason:string;profile?:{name:string;bio:string}};
export type OperationOptions = {profileLimit?:number;requireOwnPosts?:boolean;signal?:AbortSignal; onProgress?:(message:string,progress?:TaskProgress)=>void;searchCheckpoint?:SearchCheckpoint;onSearchCheckpoint?:(checkpoint:SearchCheckpoint)=>Promise<void>};
export type BrowserStatus = {browser:'closed'|'opening'|'open'|'unknown';login:'unknown'|'logged_in'|'logged_out'|'verification';message:string;checkedAt:string};
export interface Collector {
 openLogin():Promise<void>;
 getBrowserStatus?():Promise<BrowserStatus>;
 resolveAuthor?(video:Video,options?:OperationOptions):Promise<Author>;
 search(keyword:string,limits:Limits,options?:OperationOptions):Promise<SearchResult>;
 collectAuthor(author:Author,cutoff:string,limit:number,options?:OperationOptions):Promise<ProfileResult>;
 inspectVideo(video:Video,options?:OperationOptions):Promise<Video>;
 sample(video:Video,outDir:string,targets?:number[],options?:OperationOptions):Promise<Frame[]>;
 close():Promise<void>;
}
export type AnalyzerResult={analysis:Analysis;usage?:unknown;cached:boolean};
export interface AnalysisEngine {
 configure(apiKey:string,model:string,config?:Partial<ProviderConfig>):void; clear():void; status():{configured:boolean;model:string;provider?:ProviderConfig['provider'];baseURL?:string;cacheIdentity?:string};
 testConnection(signal?:AbortSignal):Promise<{ok:boolean;message:string}>;
 analyze(video:Video,frameDir:string,options?:OperationOptions):Promise<AnalyzerResult>;
 scoreAuthor?(keyword:string,author:Author,videos:Video[],options?:OperationOptions):Promise<{assessment:SemanticAssessment;usage?:unknown;cacheKey:string;cached:boolean}>;
 summarize(task:ResearchTask,options?:OperationOptions):Promise<{summary:string;usage?:unknown}>;
}
