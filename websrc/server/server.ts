import { g_localInstallPathUri, g_localInstallPath,	parsePersistentHookPath, 
	HookPathParts, getJSONFromUri, buildPersistentHookPath } from './serverutils';
import { StoredGadget, AvGadgetManifest, AvNode, AvNodeType, AvNodeTransform, AvGrabEvent, 
	AvGrabEventType, MsgAttachGadgetToHook, MsgMasterStartGadget, MsgSaveSettings, 
	MsgOverrideTransform, MsgGetGadgetManifest, MsgGetGadgetManifestResponse, 
	MsgUpdateSceneGraph, EndpointAddr, endpointAddrToString, MsgGrabEvent, 
	endpointAddrsMatch, MsgGrabberState, MsgGadgetStarted, MsgSetEndpointTypeResponse, 
	MsgPokerProximity, MsgMouseEvent, MsgNodeHaptic, MsgUpdateActionState, 
	MsgDetachGadgetFromHook, MessageType, EndpointType, MsgSetEndpointType, Envelope, 
	MsgNewEndpoint, MsgLostEndpoint, parseEnvelope, MsgError, AardvarkPort,
	MsgGetInstalledGadgets, MsgGetInstalledGadgetsResponse, MsgDestroyGadget, WebSocketCloseCodes, 
	MsgResourceLoadFailed, 	MsgInstallGadget, EVolumeType, parseEndpointFieldUri, MsgUserInfo, 
	MsgRequestJoinChamber, MsgActuallyJoinChamber, MsgRequestLeaveChamber, MsgActuallyLeaveChamber, 
	MsgChamberList, chamberIdToPath, gadgetDetailsToId
} from '@aardvarkxr/aardvark-shared';
import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import bind from 'bind-decorator';
import * as path from 'path';
import { persistence } from './persistence';
import isUrl from 'is-url';

console.log( "Data directory is", g_localInstallPathUri );


interface GadgetToStart
{
	storedData: StoredGadget;
	hookPath: string;
}

class CDispatcher
{
	private m_endpoints: { [connectionId: number ]: CEndpoint } = {};
	private m_monitors: CEndpoint[] = [];
	private m_renderers: CEndpoint[] = [];
	private m_gadgets: CEndpoint[] = [];
	private m_gadgetsByUuid: { [ uuid: string ] : CEndpoint } = {};
	private m_nextSequenceNumber = 1;
	private m_chambers = new Set<string>();

	constructor()
	{
	}

	public get nextSequenceNumber()
	{
		return this.m_nextSequenceNumber++;
	}

	private getListForType( ept: EndpointType )
	{
		switch( ept )
		{
			case EndpointType.Gadget:
				return this.m_gadgets;

			case EndpointType.Monitor:
				return this.m_monitors;

			case EndpointType.Renderer:
				return this.m_renderers;
		}

		return null;
	}

	public addPendingEndpoint( ep: CEndpoint )
	{
		this.m_endpoints[ ep.getId() ] = ep;
	}

	public setEndpointType( ep: CEndpoint )
	{
		let list = this.getListForType( ep.getType() );
		if( list )
		{
			list.push( ep );
		}

		if( ep.getType() == EndpointType.Monitor )
		{
			this.sendStateToMonitor( ep );
		}
		else if( ep.getType() == EndpointType.Renderer )
		{
			// tell the renderer about everybody's scene graphs
			for( let epid in this.m_endpoints )
			{
				let existingEp = this.m_endpoints[ epid ];
				if( existingEp.getType() == EndpointType.Gadget )
				{
					let gadgetData = existingEp.getGadgetData();
					if( gadgetData )
					{
						ep.sendMessageString(
							this.buildPackedEnvelope( 
								this.buildUpdateSceneGraphMessage( existingEp.getId(), gadgetData.getRoot(), gadgetData.getHook() ) ) );
					}
				}
			}
		}

		if( ep.getGadgetData() )
		{
			this.m_gadgetsByUuid[ ep.getGadgetData().getPersistenceUuid() ] = ep;
		}
	}

	public sendToMaster( type: MessageType, m: any )
	{
		let ep = this.m_gadgetsByUuid[ "master" ];
		if( ep )
		{
			ep.sendMessage( type, m );
		}
		else
		{
			console.log( "Tried to send message to master, but there is no master gadget endpoint" );
		}
	}

	public removeEndpoint( ep: CEndpoint )
	{
		let list = this.getListForType( ep.getType() );
		if( list )
		{
			let i = list.indexOf( ep );
			if( i != -1 )
			{
				list.splice( i, 1 );
			}
		}
		delete this.m_endpoints[ ep.getId() ];

		if( ep.getGadgetData() )
		{
			delete this.m_gadgetsByUuid[ ep.getGadgetData().getPersistenceUuid() ];
		}
	}

	private sendStateToMonitor( targetEp: CEndpoint )
	{
		for( let epid in this.m_endpoints )
		{
			let ep = this.m_endpoints[ epid ];
			switch( ep.getType() )
			{
				case EndpointType.Gadget:
					targetEp.sendMessageString( 
						this.buildPackedEnvelope( 
							this.buildNewEndpointMessage( ep ) ) );

					let gadgetData = ep.getGadgetData();
					if( gadgetData )
					{
						targetEp.sendMessageString(
							this.buildPackedEnvelope( 
								this.buildUpdateSceneGraphMessage( ep.getId(), gadgetData.getRoot(), gadgetData.getHook() ) ) );
					}
					break;

				case EndpointType.Renderer:
					targetEp.sendMessageString( 
						this.buildPackedEnvelope( 
							this.buildNewEndpointMessage( ep ) ) );
					break;
			}
		}

		this.sendChamberUpdate();
	}

	public buildPackedEnvelope( env: Envelope )
	{
		if( !env.payloadUnpacked )
		{
			return JSON.stringify( env );
		}
		else 
		{
			let packedEnv: Envelope =
			{
				type: env.type,
				sequenceNumber: this.nextSequenceNumber,
				sender: env.sender,
				target: env.target,
			}

			if( env.payloadUnpacked )
			{
				packedEnv.payload = JSON.stringify( env.payloadUnpacked );
			}
			return JSON.stringify( packedEnv );
		}
	}


	public sendToAllEndpointsOfType( ept: EndpointType, env: Envelope )
	{
		let list = this.getListForType( ept );
		if( list )
		{
			let msgString = this.buildPackedEnvelope( env );

			for( let ep of list )
			{
				ep.sendMessageString( msgString );
			}
		}
	}

	public updateGadgetSceneGraph( gadgetId: number, root: AvNode, hook: string | GadgetHookAddr )
	{
		let env = this.buildUpdateSceneGraphMessage( gadgetId, root, hook );
		this.sendToAllEndpointsOfType( EndpointType.Monitor, env );
		this.sendToAllEndpointsOfType( EndpointType.Renderer, env );
	}

	private buildUpdateSceneGraphMessage( gadgetId: number, root: AvNode, 
		hook: string | GadgetHookAddr ): Envelope
	{
		let msg: MsgUpdateSceneGraph = 
		{
			root,
		};

		if( hook )
		{
			if( typeof hook === "string" )
			{
				msg.hook = hook;
			}
			else
			{
				msg.hook = hook.hookAddr;
				msg.hookFromGadget = hook.hookFromGadget;
			}	
		}

		return (
		{
			type: MessageType.UpdateSceneGraph,
			sequenceNumber: this.nextSequenceNumber,
			sender: { type: EndpointType.Gadget, endpointId: gadgetId },
			payloadUnpacked: msg,
		} );
	}


	public buildNewEndpointMessage( ep: CEndpoint ): Envelope
	{
		let newEpMsg: MsgNewEndpoint =
		{
			newEndpointType: ep.getType(),
			endpointId: ep.getId(),
		}

		if( ep.getGadgetData() )
		{
			newEpMsg.gadgetUri = ep.getGadgetData().getUri();
		}

		return (
		{
			sender: { type: EndpointType.Hub },
			type: MessageType.NewEndpoint,
			sequenceNumber: this.nextSequenceNumber,
			payloadUnpacked: newEpMsg,
		} );
	}

	public forwardToEndpoint( epa: EndpointAddr, env: Envelope )
	{
		if( endpointAddrsMatch( epa, env.sender ) )
		{
			// don't forward messages back to whomever just sent them
			return;
		}

		let ep = this.m_endpoints[ epa.endpointId ];
		if( !ep )
		{
			console.log( "Sending message to unknown endpoint " + endpointAddrToString( epa ) );
			return;
		}

		ep.sendMessage( env.type, env.payloadUnpacked, epa, env.sender );
	}

	public forwardToHookNodes( env: Envelope )
	{
		for( let gadget of this.m_gadgets )
		{
			let hookNodes = gadget.getGadgetData().getHookNodes();
			if( !hookNodes )
				continue;
			
			for( let hookData of hookNodes )
			{
				this.forwardToEndpoint( hookData.epa, env );
			}
		}
	}

	public getGadgetEndpoint( gadgetId: number ) : CEndpoint
	{
		let ep = this.m_endpoints[ gadgetId ];
		if( ep && ep.getType() == EndpointType.Gadget )
		{
			return ep;
		}
		else
		{
			return null;
		}
	}

	public getPersistentNodePath( hookId: EndpointAddr, hookFromGadget: AvNodeTransform )
	{
		let gadget = this.getGadgetEndpoint( hookId.endpointId );
		if( gadget )
		{
			return gadget.getGadgetData().getPersistentNodePath( hookId, hookFromGadget );
		}
		else
		{
			return null;
		}
	}

	public startOrRehookGadget( uri: string, initialHookPath: string, persistenceUuid: string )
	{
		// see if this gadget already exists
		let gadget = this.m_gadgetsByUuid[ persistenceUuid ];
		if( !gadget )
		{
			this.tellMasterToStartGadget( uri, initialHookPath, persistenceUuid );
			return;
		}

		// tell the gadget to move to the newly available hook
		let gadgetData = gadget.getGadgetData();
		let hookParts = parsePersistentHookPath( initialHookPath );
		if( hookParts )
		{
			let hookAddr = this.findHook( hookParts );
			if( hookAddr )
			{
				gadgetData.setHook( { ...hookParts, hookAddr } );
			}
		}
		else
		{
			gadgetData.setHook( initialHookPath );
		}
		gadgetData.sendSceneGraphToRenderer( false, true );
	}

	public tellMasterToStartGadget( uri: string, initialHook: string, persistenceUuid: string )
	{
		if( !this.m_gadgetsByUuid[ persistenceUuid ] )
		{
			// we don't have one of these gadgets yet, so tell master to start one
			let msg: MsgMasterStartGadget =
			{
				uri: uri,
				initialHook: initialHook,
				persistenceUuid: persistenceUuid,
			} 

			this.sendToMaster( MessageType.MasterStartGadget, msg );
		}
	}

	public findHook( hookInfo:HookPathParts ): EndpointAddr
	{
		let gadgetEp = this.m_gadgetsByUuid[ hookInfo.gadgetUuid ];
		if( gadgetEp )
		{
			return gadgetEp.getGadgetData().getHookNodeByPersistentName( hookInfo.hookPersistentName );
		}
		else
		{
			return null;
		}
	}

	public sendMessageToAllEndpointsOfType( ept: EndpointType, type: MessageType, m: object )
	{
		this.sendToAllEndpointsOfType( ept,
		{
			sender: { type: EndpointType.Hub },
			type,
			sequenceNumber: this.nextSequenceNumber,
			payloadUnpacked: m,
		} );
	}

	private sendChamberUpdate()
	{
		let m: MsgChamberList =
		{
			chamberPaths: Array.from( this.m_chambers.values() )
		}

		this.sendMessageToAllEndpointsOfType( EndpointType.Monitor, MessageType.ChamberList, m );
	}
	
	public addChamber( chamberPath: string )
	{
		this.m_chambers.add( chamberPath );
		this.sendChamberUpdate();
	}

	public removeChamber( chamberPath: string )
	{
		this.m_chambers.delete( chamberPath );
		this.sendChamberUpdate();
	}
}

interface HookNodeData
{
	epa: EndpointAddr;
	persistentName: string;
}

interface GadgetHookAddr extends HookPathParts
{
	hookAddr: EndpointAddr;
}

class CGadgetData
{
	private m_gadgetUri: string;
	private m_ep: CEndpoint;
	private m_manifest: AvGadgetManifest = null;
	private m_root: AvNode = null;
	private m_hook: string | GadgetHookAddr = null;
	private m_mainGrabbable: EndpointAddr = null;
	private m_mainHandle: EndpointAddr = null;
	private m_persistenceUuid: string = null;
	private m_dispatcher: CDispatcher = null;
	private m_hookNodes:HookNodeData[] = [];
	private m_transformOverrides: { [ nodeId: number ]: AvNodeTransform } = {}
	private m_gadgetBeingDestroyed = false;

	constructor( ep: CEndpoint, uri: string, initialHook: string, persistenceUuid:string,
		dispatcher: CDispatcher )
	{
		if( persistenceUuid )
		{
			if( !initialHook )
			{
				initialHook = persistence.getGadgetHookPath( persistenceUuid );
			}

			this.m_persistenceUuid = persistenceUuid;
		}
		else
		{
			this.m_persistenceUuid = persistence.createGadgetPersistence( uri );
			if( initialHook )
			{
				persistence.setGadgetHook( this.m_persistenceUuid, initialHook, null );
			}
		}

		this.m_ep = ep;
		this.m_gadgetUri = uri;
		this.m_dispatcher = dispatcher;

		let hookInfo = parsePersistentHookPath( initialHook );
		if( !hookInfo )
		{
			// must not be a gadget hook
			this.m_hook = initialHook;
		}
		else
		{
			let hookAddr = this.m_dispatcher.findHook( hookInfo );
			if( !hookAddr )
			{
				console.log( `Expected to find hook ${ initialHook } for ${ this.m_ep.getId() }` );
			}
			else
			{
				this.m_hook = 
				{
					...hookInfo,
					hookAddr  
				};
			}
		}
	}

	public async init()
	{
		try
		{
			let manifestJson = await getJSONFromUri( this.m_gadgetUri + "/gadget_manifest.json" );
			this.m_manifest = manifestJson as AvGadgetManifest;
			console.log( `Gadget ${ this.m_ep.getId() } is ${ this.getName() }` );
		}
		catch( e )
		{
			console.log( `failed to load manifest from ${ this.m_gadgetUri }`, e );
			this.m_ep.close();
		}
	}

	public getUri() { return this.m_gadgetUri; }
	public getId() { return gadgetDetailsToId( this.getName(), this.getUri() ); }
	public getName() { return this.m_manifest.name; }
	public getRoot() { return this.m_root; }
	public getHook() { return this.m_hook; }
	public getHookNodes() { return this.m_hookNodes; }
	public getPersistenceUuid() { return this.m_persistenceUuid; }
	public isMaster() { return this.m_persistenceUuid == "master"; }
	public setHook( newHook: string | GadgetHookAddr ) { this.m_hook = newHook; }
	public isBeingDestroyed() { return this.m_gadgetBeingDestroyed; }

	public verifyPermission( permissionName: string )
	{
		if( !this.m_manifest )
		{
			throw new Error( `Verify permission ${ permissionName } on gadget with no manifest` );
		}

		if( !this.m_manifest?.permissions.includes( permissionName ) )
		{
			throw new Error( `Verify permission ${ permissionName } on gadget ${ this.m_gadgetUri } FAILED` );
		}
	}

	public getHookNodeByPersistentName( hookPersistentName: string )
	{
		for( let hook of this.m_hookNodes )
		{
			if( hook.persistentName == hookPersistentName )
			{
				return hook.epa;
			}
		}

		return null;
	}


	public sendSceneGraphToRenderer( firstUpdate: boolean, forceResendHook?: boolean )
	{
		let hookToSend = this.m_hook;
		if( !firstUpdate && !forceResendHook )
		{
			// Only send endpoint hooks once so the main grabbable
			// can actually be grabbed.
			if( typeof this.m_hook !== "string" )
			{
				hookToSend = null;
			}
		}

		this.m_hookNodes = [];
		this.m_mainGrabbable = null;
		this.m_mainHandle = null;
		this.updateNode( this.m_root );
		this.m_dispatcher.updateGadgetSceneGraph( this.m_ep.getId(), this.m_root, hookToSend );
	}

	public updateSceneGraph( root: AvNode ) 
	{
		if( this.m_gadgetBeingDestroyed )
		{
			return;
		}

		let firstUpdate = this.m_root == null;
		this.m_root = root;
		this.sendSceneGraphToRenderer( firstUpdate );

		if( firstUpdate )
		{
			// make sure the hook knows this thing is on it and that this thing knows it's
			// on the hook
			if( this.m_hook && typeof this.m_hook !== "string" )
			{
				if( this.m_mainGrabbable == null )
				{
					console.log( `Gadget ${ this.m_ep.getId() } is on a hook but`
						+ ` doesn't have a main grabbable` );
					this.m_hook = null;
				}
				else
				{
					let event: AvGrabEvent =
					{
						type: AvGrabEventType.EndGrab,
						hookId: this.m_hook.hookAddr,
						grabbableId: this.m_mainGrabbable,
						handleId: this.m_mainHandle,
						hookFromGrabbable: this.m_hook.hookFromGadget,
					};

					let msg: MsgGrabEvent =
					{
						event,
					}

					let env: Envelope =
					{
						type: MessageType.GrabEvent,
						sequenceNumber: this.m_dispatcher.nextSequenceNumber,
						payloadUnpacked: msg,
					}

					this.m_dispatcher.forwardToEndpoint( this.m_hook.hookAddr, env );
					this.m_dispatcher.forwardToEndpoint( this.m_mainGrabbable, env );
					this.m_dispatcher.sendToAllEndpointsOfType( EndpointType.Monitor, env );
				}
			}

			let gadgetsToStart = persistence.getActiveGadgets();
			for( let gadget of gadgetsToStart )
			{
				let gadgetHookPath = persistence.getGadgetHookPath( gadget.uuid );
				let hookParts = parsePersistentHookPath( gadgetHookPath )
				if( ( !hookParts && this.isMaster() )
					|| ( hookParts && hookParts.gadgetUuid == this.getPersistenceUuid() ) )
				{
					this.m_dispatcher.startOrRehookGadget( gadget.uri, gadgetHookPath, gadget.uuid );
				}
			}
		}
	}

	private updateNode( node: AvNode )
	{
		if( !node )
			return;

		switch( node.type )
		{
			case AvNodeType.Hook:
				this.m_hookNodes.push(
					{ 
						epa:
						{
							endpointId: this.m_ep.getId(),
							type: EndpointType.Node,
							nodeId: node.id,
						},
						persistentName: node.persistentName,
					}
				);
				break;

			case AvNodeType.Grabbable:
				if( !this.m_mainGrabbable )
				{
					this.m_mainGrabbable = 
					{
						endpointId: this.m_ep.getId(),
						type: EndpointType.Node,
						nodeId: node.id,
					};
				}
				break;

			case AvNodeType.Handle:
				if( !this.m_mainHandle )
				{
					this.m_mainHandle = 
					{
						endpointId: this.m_ep.getId(),
						type: EndpointType.Node,
						nodeId: node.id,
					};
				}

				switch( node.propVolume.type )
				{
					case EVolumeType.ModelBox:
						if( !isUrl( node.propVolume.uri ) && !parseEndpointFieldUri( node.propVolume.uri ) )
						{
							node.propVolume.uri = this.m_gadgetUri + "/" + node.propVolume.uri;
						}
						break;
				}
				break;

			case AvNodeType.Transform:
				if( this.m_transformOverrides )
				{
					let override = this.m_transformOverrides[ node.id ];
					if( override )
					{
						node.propTransform = override;
					}
				}
				break;
		
			case AvNodeType.Model:
				if( !isUrl( node.propModelUri ) && !parseEndpointFieldUri( node.propModelUri ) )
				{
					node.propModelUri = this.m_gadgetUri + "/" + node.propModelUri;
				}
				break;

			default:
				// many node types need no processing
		}

		if( node.children )
		{
			for( let child of node.children )
			{
				this.updateNode( child );
			}
		}
	}

	public getPersistentNodePath( hookId: EndpointAddr, hookFromGadget: AvNodeTransform )
	{
		for( let hookData of this.m_hookNodes )
		{
			if( hookData.epa.nodeId == hookId.nodeId )
			{
				return buildPersistentHookPath( this.m_persistenceUuid, hookData.persistentName, 
					hookFromGadget );
			}
		}
		return null;
	}

	
	public overrideTransform( nodeId: EndpointAddr, transform: AvNodeTransform )
	{
		if( this.m_gadgetBeingDestroyed )
		{
			return;
		}

		if( transform )
		{
			this.m_transformOverrides[ nodeId.nodeId ] = transform;
		}
		else
		{
			delete this.m_transformOverrides[ nodeId.nodeId ];
		}
		this.sendSceneGraphToRenderer( false );
	}

	public destroyPersistence()
	{
		this.m_gadgetBeingDestroyed = true;
		persistence.destroyGadgetPersistence( this.m_gadgetUri, this.m_persistenceUuid );
	}
}


interface EnvelopeHandler
{
	(env: Envelope, m: any): void;
}

interface ForwardHandler
{
	(m: any ): ( EndpointAddr | EndpointType ) [];
}

class CEndpoint
{
	private m_ws: WebSocket = null;
	private m_id: number;
	private m_origin: string| string[];
	private m_type = EndpointType.Unknown;
	private m_dispatcher: CDispatcher = null;
	private m_gadgetData: CGadgetData = null;
	private m_envelopeHandlers: { [ type:number]: EnvelopeHandler } = {};
	private m_forwardHandlers: { [type: number]: ForwardHandler } = {};

	constructor( ws: WebSocket, origin: string | string[], id: number, dispatcher: CDispatcher )
	{
		console.log( "new connection from ", origin );
		this.m_ws = ws;
		this.m_origin = origin;
		this.m_id = id;
		this.m_dispatcher = dispatcher;

		ws.on( 'message', this.onMessage );
		ws.on( 'close', this.onClose );

		this.registerEnvelopeHandler( MessageType.SetEndpointType, this.onSetEndpointType );
		this.registerEnvelopeHandler( MessageType.GetGadgetManifest, this.onGetGadgetManifest );
		this.registerEnvelopeHandler( MessageType.UpdateSceneGraph, this.onUpdateSceneGraph );
		this.registerForwardHandler( MessageType.GrabberState, ( m: MsgGrabberState ) =>
		{
			return [m.grabberId, EndpointType.Monitor ];
		} );
		this.registerEnvelopeHandler( MessageType.GrabEvent, this.onGrabEvent );
		this.registerEnvelopeHandler( MessageType.GadgetStarted, this.onGadgetStarted );
		this.registerForwardHandler( MessageType.PokerProximity, ( m: MsgPokerProximity ) =>
		{
			return [ m.pokerId, EndpointType.Monitor ];
		} );
		this.registerForwardHandler( MessageType.MouseEvent, ( m: MsgMouseEvent ) =>
		{
			return [ m.event.panelId, EndpointType.Monitor ];
		} );
		this.registerForwardHandler( MessageType.NodeHaptic, ( m: MsgNodeHaptic ) =>
		{
			return [ EndpointType.Monitor, EndpointType.Renderer ];
		} );
		this.registerEnvelopeHandler( MessageType.AttachGadgetToHook, this.onAttachGadgetToHook );
		this.registerEnvelopeHandler( MessageType.DetachGadgetFromHook, this.onDetachGadgetFromHook );
		this.registerEnvelopeHandler( MessageType.SaveSettings, this.onSaveSettings );
		this.registerForwardHandler( MessageType.UpdateActionState, (m:MsgUpdateActionState) =>
		{
			return [ { type: EndpointType.Gadget, endpointId: m.gadgetId } ];
		});
		this.registerForwardHandler( MessageType.ResourceLoadFailed, ( m: MsgResourceLoadFailed ) =>
		{
			return [ EndpointType.Monitor, m.nodeId ];
		});

		this.registerEnvelopeHandler( MessageType.OverrideTransform, this.onOverrideTransform );

		this.registerEnvelopeHandler( MessageType.GetInstalledGadgets, this.onGetInstalledGadgets );
		this.registerEnvelopeHandler( MessageType.DestroyGadget, this.onDestroyGadget );
		this.registerEnvelopeHandler( MessageType.InstallGadget, this.onInstallGadget );
		this.registerEnvelopeHandler( MessageType.RequestJoinChamber, this.onRequestJoinChamber );
		this.registerEnvelopeHandler( MessageType.RequestLeaveChamber, this.onRequestLeaveChamber );
	}

	public getId() { return this.m_id; }
	public getType() { return this.m_type; }
	public getGadgetData() { return this.m_gadgetData; }

	private registerEnvelopeHandler( type: MessageType, handler: EnvelopeHandler )
	{
		this.m_envelopeHandlers[ type as number ] = handler;
	}

	private callEnvelopeHandler( env: Envelope ): boolean
	{
		let handler = this.m_envelopeHandlers[ env.type as number ];
		if( handler )
		{
			try
			{
				handler( env, env.payloadUnpacked );
			}
			catch( e )
			{
				console.log( `Error processing message of type ${ MessageType[ env.type ] } `
					+ `from ${ endpointAddrToString( env.sender ) }: ${ e }`)
			}
			return true;
		}
		else
		{
			return false;
		}
	}
	private registerForwardHandler( type: MessageType, handler: ForwardHandler )
	{
		this.m_forwardHandlers[ type ] = handler;
		this.registerEnvelopeHandler( type, this.onForwardedMessage );
	}

	@bind private onForwardedMessage( env: Envelope, m: any )
	{
		let handler = this.m_forwardHandlers[ env.type ];
		if( handler )
		{
			let eps = handler( m );
			if( eps )
			{
				for( let ep of eps )
				{
					if( typeof ep === "object" )
					{
						this.m_dispatcher.forwardToEndpoint( ep as EndpointAddr, env );
					}
					else if( typeof ep === "number" )
					{
						this.m_dispatcher.sendToAllEndpointsOfType( ep as EndpointType, env );
					}
				}
			}
		}
	}

	@bind onMessage( message: string )
	{
		let env:Envelope = parseEnvelope( message );
		if( !env )
		{
			return;
		}

		env.sender = { type: this.m_type, endpointId: this.m_id };

		if( this.m_type == EndpointType.Unknown )
		{
			if( env.type != MessageType.SetEndpointType )
			{
				this.sendError( "SetEndpointType must be the first message from an endpoint" );
				return;
			}
		}
		else if( env.type == MessageType.SetEndpointType )
		{
			this.sendError( "SetEndpointType may only be sent once", MessageType.SetEndpointType );
			return;
		}

		if( !this.callEnvelopeHandler( env ) )
		{
			this.sendError( "Unsupported message", env.type );
		}

	}

	@bind private onGetGadgetManifest( env: Envelope, m: MsgGetGadgetManifest )
	{
		getJSONFromUri( m.gadgetUri + "/gadget_manifest.json" )
		.then( ( jsonManifest: any ) =>
		{
			let response: MsgGetGadgetManifestResponse =
			{
				manifest: jsonManifest as AvGadgetManifest,
				gadgetUri: m.gadgetUri,
			}

			if( !isUrl( response.manifest.model ) )
			{
				response.manifest.model = m.gadgetUri + "/" + response.manifest.model;
			}

			this.sendReply( MessageType.GetGadgetManifestResponse, response, env );
		})
		.catch( (reason:any ) =>
		{
			let response: MsgGetGadgetManifestResponse =
			{
				error: "Unable to load manifest " + reason,
				gadgetUri: m.gadgetUri,
			}
			this.sendReply( MessageType.GetGadgetManifestResponse, response, env );
		})

	}

	@bind private onUpdateSceneGraph( env: Envelope, m: MsgUpdateSceneGraph )
	{
		if( !this.m_gadgetData )
		{
			this.sendError( "Only valid from gadgets", MessageType.UpdateSceneGraph );
			return;
		}

		this.m_gadgetData.updateSceneGraph( m.root );
	}

	private isGadgetUriAllowed( gadgetUri: string ):boolean
	{
		return ( this.m_origin == "http://localhost:23842" ||  gadgetUri.startsWith( this.m_origin as string ) )
			&& persistence.isGadgetUriInstalled( gadgetUri );
	}

	@bind private async onSetEndpointType( env: Envelope, m: MsgSetEndpointType )
	{
		switch( m.newEndpointType )
		{
			case EndpointType.Gadget:
				if( !m.gadgetUri )
				{
					this.sendError( "SetEndpointType to gadget must provide URI",
						MessageType.SetEndpointType );
					return;
				}

				if( !this.isGadgetUriAllowed( m.gadgetUri ) )
				{
					this.sendError( `Gadget URI is not allowed: ${ m.gadgetUri }`,
						MessageType.SetEndpointType );
					return;
				}
				break;

			case EndpointType.Monitor:
			case EndpointType.Renderer:
			case EndpointType.Utility:
				break;

			default:
				this.sendError( "New endpoint type must be Gadget, Monitor, or Renderer", 
					MessageType.SetEndpointType );
				return;

		}

		console.log( `Setting endpoint ${ this.m_id } to ${ EndpointType[ m.newEndpointType ]}` );
		this.m_type = m.newEndpointType;

		let msgResponse: MsgSetEndpointTypeResponse =
		{
			endpointId: this.m_id,
		}

		if( this.getType() == EndpointType.Gadget )
		{
			console.log( " initial hook is " + m.initialHook );
			this.m_gadgetData = new CGadgetData( this, m.gadgetUri, m.initialHook, m.persistenceUuid,
				this.m_dispatcher );

			// Don't reply to the SetEndpointType until we've inited the gadget.
			// This loads the manifest for the gadget and has the chance to verify
			// some stuff.
			await this.m_gadgetData.init(); 

			let settings = persistence.getGadgetSettings( this.m_gadgetData.getPersistenceUuid() );
			if( settings )
			{
				msgResponse.settings = settings;
			}

			msgResponse.persistenceUuid = this.m_gadgetData.getPersistenceUuid();
		}

		this.sendMessage( MessageType.SetEndpointTypeResponse, msgResponse );

		let msgUserInfo: MsgUserInfo =
		{
			info: persistence.localUserInfo,
		}
		this.sendMessage( MessageType.UserInfo, msgUserInfo );
		
		this.m_dispatcher.setEndpointType( this );

		this.m_dispatcher.sendToAllEndpointsOfType( EndpointType.Monitor,
			this.m_dispatcher.buildNewEndpointMessage( this ) );
	}

	@bind private onGrabEvent( env: Envelope, m: MsgGrabEvent )
	{
		if( m.event.grabberId )
		{
			this.m_dispatcher.forwardToEndpoint( m.event.grabberId, env );
		}
		if( m.event.grabbableId )
		{
			this.m_dispatcher.forwardToEndpoint( m.event.grabbableId, env );
		}
		if( m.event.handleId )
		{
			this.m_dispatcher.forwardToEndpoint( m.event.handleId, env );
		}
		if( m.event.hookId )
		{
			this.m_dispatcher.forwardToEndpoint( m.event.hookId, env );
		}

		if( m.event.type == AvGrabEventType.StartGrab || m.event.type == AvGrabEventType.EndGrab )
		{
			// start and end grab events also go to all hooks so they can highlight
			this.m_dispatcher.forwardToHookNodes( env );
		}

		if( env.sender.type != EndpointType.Renderer )
		{
			this.m_dispatcher.sendToAllEndpointsOfType( EndpointType.Renderer, env );
		}
		this.m_dispatcher.sendToAllEndpointsOfType( EndpointType.Monitor, env );
	}

	@bind private onGadgetStarted( env:Envelope, m: MsgGadgetStarted )
	{
		if( m.mainGrabbable )
		{
			m.mainGrabbableGlobalId = 
			{ 
				type: EndpointType.Node, 
				endpointId: this.m_id,
				nodeId: m.mainGrabbable,
			};
		}
		if( m.mainHandle )
		{
			m.mainHandleGlobalId = 
			{ 
				type: EndpointType.Node, 
				endpointId: this.m_id,
				nodeId: m.mainHandle,
			};
		}

		this.m_dispatcher.forwardToEndpoint( m.epToNotify, env );
	}

	@bind private onAttachGadgetToHook( env: Envelope, m: MsgAttachGadgetToHook )
	{
		let gadget = this.m_dispatcher.getGadgetEndpoint( m.grabbableNodeId.endpointId );
		gadget.attachToHook( m.hookNodeId, m.hookFromGrabbable );
	}

	@bind private onDetachGadgetFromHook( env: Envelope, m: MsgDetachGadgetFromHook )
	{
		let gadget = this.m_dispatcher.getGadgetEndpoint( m.grabbableNodeId.endpointId );
		gadget.detachFromHook( m.hookNodeId );
	}

	private attachToHook( hookId: EndpointAddr, hookFromGrabbable: AvNodeTransform )
	{
		let hookPath = this.m_dispatcher.getPersistentNodePath( hookId, hookFromGrabbable );
		if( !hookPath )
		{
			console.log( `can't attach ${ this.m_id } to `
				+`${ endpointAddrToString( hookId ) } because it doesn't have a path` );
			return;
		}

		persistence.setGadgetHookPath( this.m_gadgetData.getPersistenceUuid(), hookPath );
	}

	private detachFromHook( hookId: EndpointAddr )
	{
		persistence.setGadgetHook( this.m_gadgetData.getPersistenceUuid(), null, null );
	}

	@bind private onSaveSettings( env: Envelope, m: MsgSaveSettings )
	{
		if( this.m_gadgetData && !this.m_gadgetData.isBeingDestroyed() )
		{
			persistence.setGadgetSettings( this.m_gadgetData.getPersistenceUuid(), m.settings );
		}
	}

	@bind private onOverrideTransform( env: Envelope, m: MsgOverrideTransform )
	{
		let ep = this.m_dispatcher.getGadgetEndpoint( m.nodeId.endpointId );
		let gadgetData = ep.getGadgetData();
		gadgetData.overrideTransform( m.nodeId, m.transform );
	}

	@bind private onGetInstalledGadgets( env: Envelope, m: MsgGetInstalledGadgets )
	{
		let resp: MsgGetInstalledGadgetsResponse =
		{
			installedGadgets: persistence.getInstalledGadgets()
		}
		this.sendReply( MessageType.GetInstalledGadgetsResponse, resp, env );
	}

	@bind private onInstallGadget( env: Envelope, m: MsgInstallGadget )
	{
		console.log( `Installing gadget from web ${ m.gadgetUri }` );
		persistence.addInstalledGadget( m.gadgetUri );
	}

	public verifyPermission( permissionName: string )
	{
		if( !this.getGadgetData() )
		{
			throw new Error( "No gadget data on check for permission " + permissionName );
		}

		this.getGadgetData().verifyPermission( permissionName );
	}

	@bind private onRequestJoinChamber( env: Envelope, m: MsgRequestJoinChamber )
	{
		this.verifyPermission( "chamber" );
		let req: MsgActuallyJoinChamber =
		{
			chamberPath: chamberIdToPath( this.getGadgetData().getId(), m.chamberId ),
			userUuid: persistence.localUserInfo.userUuid,
			userPublicKey: persistence.localUserInfo.userPublicKey,
		}
		let reqSigned = persistence.signRequest( req );
		this.m_dispatcher.sendToMaster( MessageType.ActuallyJoinChamber, reqSigned );
		this.m_dispatcher.addChamber( req.chamberPath );
	}

	@bind private onRequestLeaveChamber( env: Envelope, m: MsgRequestLeaveChamber )
	{
		this.verifyPermission( "chamber" );
		let req: MsgActuallyLeaveChamber =
		{
			chamberPath: chamberIdToPath( this.getGadgetData().getId(), m.chamberId ),
			userUuid: persistence.localUserInfo.userUuid,
		}
		let reqSigned = persistence.signRequest( req );
		this.m_dispatcher.sendToMaster( MessageType.ActuallyLeaveChamber, reqSigned );
		this.m_dispatcher.removeChamber( req.chamberPath );
	}

	@bind private onDestroyGadget( env: Envelope, m: MsgDestroyGadget )
	{
		let ep = this.m_dispatcher.getGadgetEndpoint( m.gadgetId );
		if( !ep )
		{
			console.log( `Request to destroy gadget ${ m.gadgetId }, which does not exist` );
			return;
		}

		ep.startDestroyGadget();
	}

	private startDestroyGadget()
	{
		if( this.m_gadgetData )
		{
			this.m_gadgetData.destroyPersistence();
		}
		this.m_ws.close( WebSocketCloseCodes.UserDestroyedGadget );
	}

	public sendMessage( type: MessageType, msg: any, target: EndpointAddr = undefined, sender:EndpointAddr = undefined  )
	{
		let env: Envelope =
		{
			type,
			sequenceNumber: this.m_dispatcher.nextSequenceNumber,
			sender: sender ? sender : { type: EndpointType.Hub, endpointId: 0 },
			target,
			payload: JSON.stringify( msg ),
		}
		this.sendMessageString( JSON.stringify( env ) )
	}

	public sendReply( type: MessageType, msg: any, replyTo: Envelope, sender:EndpointAddr = undefined  )
	{
		let env: Envelope =
		{
			type,
			sequenceNumber: this.m_dispatcher.nextSequenceNumber,
			sender: sender ? sender : { type: EndpointType.Hub, endpointId: 0 },
			target: replyTo.sender,
			replyTo: replyTo.sequenceNumber,
			payload: JSON.stringify( msg ),
		}
		this.sendMessageString( JSON.stringify( env ) )
	}

	public sendMessageString( msgString: string )
	{
		this.m_ws.send( msgString );
	}

	public getName()
	{
		return `#${ this.m_id } (${ EndpointType[ this.m_type ] })`;
	}
	public sendError( error: string, messageType?: MessageType )
	{
		let msg: MsgError =
		{
			error,
			messageType,
		};
		this.sendMessage( MessageType.Error, msg );

		console.log( `sending error to endpoint ${ this.getName() }: ${ error }` );
	}

	public close()
	{
		this.m_ws.close();
	}

	@bind onClose( code: number, reason: string )
	{
		console.log( `connection closed ${ reason }(${ code })` );
		this.m_dispatcher.removeEndpoint( this );

		let lostEpMsg: MsgLostEndpoint =
		{
			endpointId: this.m_id,
		}

		if( this.m_type == EndpointType.Gadget && this.m_gadgetData && this.m_gadgetData.getRoot() )
		{
			// Let renderers know that this gadget is no more.
			this.m_dispatcher.updateGadgetSceneGraph( this.m_id, null, null );
		}

		this.m_dispatcher.sendToAllEndpointsOfType( EndpointType.Monitor,
			{
				sender: { type: EndpointType.Hub },
				type: MessageType.LostEndpoint,
				sequenceNumber: this.m_dispatcher.nextSequenceNumber,
				payloadUnpacked: lostEpMsg,
			} );
		
		this.m_gadgetData = null;
	}
}


class CServer
{
	private m_app = express();
	private m_server = http.createServer( this.m_app );
	private m_wss:WebSocket.Server = null;
	private m_nextEndpointId = 27;
	private m_dispatcher = new CDispatcher;

	constructor( port: number )
	{
		this.m_wss = new WebSocket.Server( { server: this.m_server } );
		this.m_server.listen( port, () => 
		{
			console.log(`Server started on port ${ port } :)`);

			this.m_wss.on('connection', this.onConnection );
		} );

		this.m_app.use( "/gadgets", express.static( path.resolve( g_localInstallPath, "gadgets" ) ) );
		this.m_app.use( "/models", express.static( path.resolve( g_localInstallPath, "models" ) ) );
	}

	@bind onConnection( ws: WebSocket, request: http.IncomingMessage )
	{
		this.m_dispatcher.addPendingEndpoint( 
			new CEndpoint( ws, request.headers.origin, this.m_nextEndpointId++, this.m_dispatcher ) );
	}
}

// the VS Code debugger and the source maps get confused if the CWD is not the workspace dir.
// Instead, just chdir to the data directory if we start in the workspace dir.
let p = process.cwd();
if( path.basename( p ) == "websrc" )
{
	process.chdir( "../data" );
}

let server:CServer;

async function startup()
{
	server = new CServer( Number( process.env.PORT ) || AardvarkPort );
	await persistence.init();
}

startup();

