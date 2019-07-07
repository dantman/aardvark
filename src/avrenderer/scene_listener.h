#pragma once
#include <tools/capnprototools.h>

#include <aardvark/aardvark_server.h>
#include <aardvark/aardvark_client.h>
#include <aardvark/aardvark_scene_graph.h>

#include "av_cef_app.h"

#include "scene_traverser.h"

class CSceneListener;
class VulkanExample;
struct SgRoot_t;

class AvFrameListenerImpl : public AvFrameListener::Server
{
public:
	virtual ::kj::Promise<void> newFrame( NewFrameContext context ) override;
	virtual ::kj::Promise<void> sendHapticEvent( SendHapticEventContext context ) override;
	virtual ::kj::Promise<void> startGrab( StartGrabContext context ) override;
	virtual ::kj::Promise<void> endGrab( EndGrabContext context ) override;

	CSceneListener *m_listener = nullptr;
};

class CSceneListener
{
	friend AvFrameListenerImpl;
public:
	CSceneListener( );

	void earlyInit( CefRefPtr<CAardvarkCefApp> app );

	void init( HINSTANCE hinstance );
	void cleanup();
	void run();


protected:
	void applyFrame( AvVisualFrame::Reader & newFrame );

	CSceneTraverser m_traverser;

	kj::Own< AvFrameListenerImpl > m_frameListener;
	std::unique_ptr<VulkanExample> m_renderer;
	CefRefPtr<CAardvarkCefApp> m_app;

	kj::Own<aardvark::CAardvarkClient> m_pClient;

	std::unique_ptr< std::vector<std::unique_ptr< SgRoot_t > > > m_roots, m_nextRoots;
	std::unique_ptr< std::map< uint32_t, tools::OwnCapnp< AvSharedTextureInfo > > > m_sharedTextureInfo, m_nextSharedTextureInfo;
};
