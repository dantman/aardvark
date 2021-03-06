// Copyright (c) 2019 The Chromium Embedded Framework Authors. All rights
// reserved. Use of this source code is governed by a BSD-style license that
// can be found in the LICENSE file.
//
// ---------------------------------------------------------------------------
//
// This file was generated by the CEF translator tool. If making changes by
// hand only do so within the body of existing method and function
// implementations. See the translator.README.txt file in the tools directory
// for more information.
//
// $hash=1ef68f8867b2479a9832a1b132f37380630079a1$
//

#include "libcef_dll/ctocpp/get_extension_resource_callback_ctocpp.h"
#include "libcef_dll/ctocpp/stream_reader_ctocpp.h"

// VIRTUAL METHODS - Body may be edited by hand.

NO_SANITIZE("cfi-icall")
void CefGetExtensionResourceCallbackCToCpp::Continue(
    CefRefPtr<CefStreamReader> stream) {
  cef_get_extension_resource_callback_t* _struct = GetStruct();
  if (CEF_MEMBER_MISSING(_struct, cont))
    return;

  // AUTO-GENERATED CONTENT - DELETE THIS COMMENT BEFORE MODIFYING

  // Unverified params: stream

  // Execute
  _struct->cont(_struct, CefStreamReaderCToCpp::Unwrap(stream));
}

NO_SANITIZE("cfi-icall") void CefGetExtensionResourceCallbackCToCpp::Cancel() {
  cef_get_extension_resource_callback_t* _struct = GetStruct();
  if (CEF_MEMBER_MISSING(_struct, cancel))
    return;

  // AUTO-GENERATED CONTENT - DELETE THIS COMMENT BEFORE MODIFYING

  // Execute
  _struct->cancel(_struct);
}

// CONSTRUCTOR - Do not edit by hand.

CefGetExtensionResourceCallbackCToCpp::CefGetExtensionResourceCallbackCToCpp() {
}

template <>
cef_get_extension_resource_callback_t*
CefCToCppRefCounted<CefGetExtensionResourceCallbackCToCpp,
                    CefGetExtensionResourceCallback,
                    cef_get_extension_resource_callback_t>::
    UnwrapDerived(CefWrapperType type, CefGetExtensionResourceCallback* c) {
  NOTREACHED() << "Unexpected class type: " << type;
  return NULL;
}

#if DCHECK_IS_ON()
template <>
base::AtomicRefCount CefCToCppRefCounted<
    CefGetExtensionResourceCallbackCToCpp,
    CefGetExtensionResourceCallback,
    cef_get_extension_resource_callback_t>::DebugObjCt ATOMIC_DECLARATION;
#endif

template <>
CefWrapperType
    CefCToCppRefCounted<CefGetExtensionResourceCallbackCToCpp,
                        CefGetExtensionResourceCallback,
                        cef_get_extension_resource_callback_t>::kWrapperType =
        WT_GET_EXTENSION_RESOURCE_CALLBACK;
