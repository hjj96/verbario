// Linux stand-in for <simd/simd.h> (type checking only): same C layouts as Apple's simd types.
#pragma once
typedef float simd_float2 __attribute__((ext_vector_type(2)));
typedef float simd_float3 __attribute__((ext_vector_type(3)));
typedef float simd_float4 __attribute__((ext_vector_type(4)));
typedef double simd_double2 __attribute__((ext_vector_type(2)));
typedef double simd_double3 __attribute__((ext_vector_type(3), aligned(16)));
typedef double simd_double4 __attribute__((ext_vector_type(4), aligned(16)));
typedef struct { simd_float3 columns[3]; } simd_float3x3;
typedef struct { simd_float4 columns[4]; } simd_float4x4;
typedef struct { simd_double4 columns[4]; } simd_double4x4;
