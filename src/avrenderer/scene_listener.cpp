#include "scene_listener.h"
#include "aardvark_renderer.h"
#include "vrmanager.h"




CSceneListener::CSceneListener( )
{
	m_renderer = std::make_unique<VulkanExample>();
	m_vrManager = std::make_unique<CVRManager>();
}

void CSceneListener::init( HINSTANCE hinstance, aardvark::CAardvarkClient *client )
{
	m_pClient = client;
	
	m_frameListener = kj::heap<AvFrameListenerImpl>();
	m_frameListener->m_listener = this;

	auto reqListen = m_pClient->Server().listenForFramesRequest();
	AvFrameListener::Client listenerClient = std::move( m_frameListener );
	reqListen.setListener( listenerClient );
	reqListen.send().wait( m_pClient->WaitScope() );

	m_vrManager->init();
	m_renderer->init( hinstance, m_vrManager.get(), m_pClient );
	m_traverser.init( m_renderer.get(), m_vrManager.get(), m_pClient );
}

void CSceneListener::cleanup()
{
	m_pClient = nullptr;
	m_traverser.cleanup();
	m_renderer = nullptr;
}

void CSceneListener::run()
{
	while ( !m_wantsQuit )
	{
		runFrame();
	}
}

void CSceneListener::runFrame()
{
	auto tStart = std::chrono::high_resolution_clock::now();

	m_vrManager->updateOpenVrPoses();
	m_traverser.TraverseSceneGraphs();
	m_renderer->processRenderList();

	auto tEnd = std::chrono::high_resolution_clock::now();
	auto tDiff = std::chrono::duration<double, std::milli>( tEnd - tStart ).count();

	m_vrManager->doInputWork();

	bool shouldQuit = false;
	m_renderer->runFrame( &shouldQuit, tDiff / 1000.0f );
	m_wantsQuit = m_wantsQuit || shouldQuit;
}


::kj::Promise<void> AvFrameListenerImpl::newFrame( NewFrameContext context )
{
	m_listener->m_traverser.newSceneGraph( context.getParams().getFrame() );
	return kj::READY_NOW;
}

::kj::Promise<void> AvFrameListenerImpl::sendHapticEvent( SendHapticEventContext context )
{
	m_listener->m_traverser.sendHapticEvent( context.getParams().getTargetGlobalId(),
		context.getParams().getAmplitude(),
		context.getParams().getFrequency(),
		context.getParams().getDuration() );
	return kj::READY_NOW;
}

::kj::Promise<void> AvFrameListenerImpl::startGrab( StartGrabContext context )
{
	uint64_t grabberGlobalId = context.getParams().getGrabberGlobalId();
	uint64_t grabbableGlobalId = context.getParams().getGrabbableGlobalId();

	m_listener->m_traverser.startGrabImpl( grabberGlobalId, grabbableGlobalId );
	return kj::READY_NOW;
}


::kj::Promise<void> AvFrameListenerImpl::endGrab( EndGrabContext context )
{
	uint64_t grabberGlobalId = context.getParams().getGrabberGlobalId();
	uint64_t grabbableGlobalId = context.getParams().getGrabbableGlobalId();
	m_listener->m_traverser.endGrabImpl( grabberGlobalId, grabbableGlobalId );
	return kj::READY_NOW;
}

