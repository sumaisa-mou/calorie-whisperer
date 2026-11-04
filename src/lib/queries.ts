import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  AnalyzeResult,
  DailyTotal,
  FoodSearchHit,
  Meal,
  MealInput,
  Profile,
  WeightEntry,
} from '../../shared/types';
import type { Workout, WorkoutInput, WorkoutPlan } from '../../shared/workout';
import type { DayReview } from '../../shared/types';

export const useProfile = () =>
  useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api<{ profile: Profile | null }>('GET', '/profile')).profile,
  });

export const useSaveProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Profile) => api<{ profile: Profile }>('PUT', '/profile', p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
};

export const useWeights = () =>
  useQuery({
    queryKey: ['weights'],
    queryFn: async () => (await api<{ weights: WeightEntry[] }>('GET', '/weights')).weights,
  });

export const useSaveWeight = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: WeightEntry) => api('PUT', '/weights', w),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weights'] }),
  });
};

export const useDeleteWeight = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api('DELETE', `/weights/${date}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weights'] }),
  });
};

export const useMeals = (from: string, to: string) =>
  useQuery({
    queryKey: ['meals', from, to],
    queryFn: async () =>
      (await api<{ meals: Meal[] }>('GET', `/meals?from=${from}&to=${to}`)).meals,
  });

export const useMeal = (id: number | null) =>
  useQuery({
    queryKey: ['meal', id],
    enabled: id !== null,
    queryFn: async () => (await api<{ meal: Meal }>('GET', `/meals/${id}`)).meal,
  });

export const useDaily = (from: string, to: string) =>
  useQuery({
    queryKey: ['daily', from, to],
    queryFn: async () =>
      (await api<{ daily: DailyTotal[] }>('GET', `/daily?from=${from}&to=${to}`)).daily,
  });

export const useSaveMeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, meal }: { id?: number; meal: MealInput }) =>
      id ? api('PUT', `/meals/${id}`, meal) : api('POST', '/meals', meal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['meal'] });
      qc.invalidateQueries({ queryKey: ['daily'] });
    },
  });
};

export const useDeleteMeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api('DELETE', `/meals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['daily'] });
    },
  });
};

export const analyzePhoto = (image: string, mimeType: string, note: string) =>
  api<AnalyzeResult>('POST', '/analyze', { image, mimeType, note });

export const analyzeText = (text: string) => api<AnalyzeResult>('POST', '/parse-text', { text });

export const searchFoods = async (q: string) =>
  (await api<{ hits: FoodSearchHit[] }>('GET', `/foods/search?q=${encodeURIComponent(q)}`)).hits;

export const sendChat = (messages: { role: 'user' | 'assistant'; content: string }[], today: string) =>
  api<{ reply: string }>('POST', '/chat', { messages, today });

export const useWorkouts = (from: string, to: string) =>
  useQuery({
    queryKey: ['workouts', from, to],
    queryFn: async () => (await api<{ workouts: Workout[] }>('GET', `/workouts?from=${from}&to=${to}`)).workouts,
  });

export const useSaveWorkout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workout }: { id?: number; workout: WorkoutInput }) =>
      id ? api('PUT', `/workouts/${id}`, workout) : api('POST', '/workouts', workout),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
};

export const useDeleteWorkout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api('DELETE', `/workouts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
};

export const useReviews = (from: string, to: string) =>
  useQuery({
    queryKey: ['reviews', from, to],
    queryFn: async () => (await api<{ reviews: DayReview[] }>('GET', `/reviews?from=${from}&to=${to}`)).reviews,
  });

export const useReviewDay = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api<{ review: DayReview }>('POST', `/reviews/${date}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
};

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api<{ settings: { weeklyWorkouts: number } }>('GET', '/settings')).settings,
  });

export const useSaveSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: { weeklyWorkouts: number }) => api('PUT', '/settings', s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
};

export const planSession = (today: string) => api<{ plan: WorkoutPlan }>('POST', '/workout-plan', { today }).then((r) => r.plan);
