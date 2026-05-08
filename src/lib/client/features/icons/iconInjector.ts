/**
 * Inject AWS icons into Mermaid SVG after rendering
 */

export const injectAWSIcons = (svgElement: SVGSVGElement): void => {
  try {
    // Find all text nodes that might represent AWS services
    const textNodes = svgElement.querySelectorAll('text');

    textNodes.forEach((node) => {
      const text = node.textContent?.toLowerCase() || '';

      // Map of AWS service names to local icon paths
      const iconMap: Record<string, string> = {
        ec2: '/icons/aws-ec2.svg',
        lambda: '/icons/aws-lambda.svg',
        s3: '/icons/aws-s3.svg',
        rds: '/icons/aws-rds.svg',
        cloudfront: '/icons/aws-cloudfront.svg',
        elb: '/icons/aws-elastic-load-balancing.svg',
        iam: '/icons/aws-iam-identity-center.svg',
        vpc: '/icons/aws-vpc.svg',
        route53: '/icons/aws-route-53.svg',
        'api gateway': '/icons/aws-api-gateway.svg'
      };

      // Check if this text matches an AWS service
      for (const [service, iconUrl] of Object.entries(iconMap)) {
        if (text.includes(service)) {
          // Get the parent node (the group containing the text)
          const parent = node.parentElement;
          if (parent) {
            // Create an image element
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttribute('href', iconUrl);
            img.setAttribute('width', '40');
            img.setAttribute('height', '40');
            img.setAttribute('x', '-20');
            img.setAttribute('y', '-20');

            // Insert the image before the text
            parent.insertBefore(img, node);

            // Optionally hide the text or move it below the icon
            node.setAttribute('y', '30'); // Move text below icon
            node.setAttribute('text-anchor', 'middle');
            break;
          }
        }
      }
    });
  } catch (error) {
    console.warn('Failed to inject AWS icons:', error);
  }
};

/**
 * Parse Mermaid code and inject AWS icons from @{ icon: "aws:service" } syntax
 * This function processes the Mermaid code before rendering to replace icon syntax with actual icons
 */
/**
 * Fetch all available icons from index.json
 */
export const getAvailableAWSIcons = async (): Promise<Record<string, string>> => {
  try {
    const response = await fetch('/icons/index.json');
    if (!response.ok) throw new Error(`Failed to load icons: ${response.status}`);
    const data = await response.json();
    const iconMap: Record<string, string> = {};
    for (const icon of data.icons || []) {
      iconMap[icon.id] = icon.path;
    }
    return iconMap;
  } catch (error) {
    console.warn('Failed to fetch icons:', error);
    return {};
  }
};

/**
 * Search for icons by service name
 */
export const searchAWSIcons = async (searchTerm: string): Promise<Record<string, string>> => {
  try {
    const response = await fetch('/icons/index.json');
    if (!response.ok) throw new Error(`Failed to load icons: ${response.status}`);
    const data = await response.json();
    const results: Record<string, string> = {};
    const q = searchTerm.toLowerCase();
    for (const icon of data.icons || []) {
      if (
        icon.id.toLowerCase().includes(q) ||
        icon.keywords.some((kw: string) => kw.toLowerCase().includes(q))
      ) {
        results[icon.id] = icon.path;
      }
    }
    return results;
  } catch (error) {
    console.warn('Failed to search icons:', error);
    return {};
  }
};

/**
 * Search for icons in the static icons directory
 */
export const searchStaticIcons = async (searchTerm: string): Promise<Record<string, string>> => {
  return searchAWSIcons(searchTerm);
};

/**
 * Get all available icons from static directory
 */
export const getStaticIcons = async (): Promise<Record<string, string>> => {
  return getAvailableAWSIcons();
};

/**
 * Parse Mermaid code and inject AWS icons from @{ icon: "aws:service" } syntax
 * This function uses static icons from the local directory
 */
export const injectAWSIconsFromCode = async (mermaidCode: string): Promise<string> => {
  try {
    // Get available static icons
    const iconMap = await getStaticIcons();

    // Replace @{ icon: "aws:service" } syntax with actual icon HTML
    let processedCode = mermaidCode;

    // Match the pattern: nodeId@{ icon: "aws:service-name" }
    const iconPattern = /(\w+)@\{\s*icon:\s*["']aws:([^"']+)["']\s*}/g;

    processedCode = processedCode.replace(iconPattern, (match, nodeId, serviceName) => {
      // Try to find the icon in our available icons
      const iconUrl = iconMap[serviceName] || iconMap[`aws-${serviceName}`];

      if (iconUrl) {
        // Replace with HTML image syntax using static path with proper aspect ratio
        return `${nodeId}["<img src='${iconUrl}' width='40' style='vertical-align: middle; margin-right: 8px; height: auto;'/>"]`;
      } else {
        // Try to search for partial matches
        for (const [availableIconName, url] of Object.entries(iconMap)) {
          if (
            availableIconName.includes(serviceName) ||
            serviceName.includes(availableIconName.replace('aws-', ''))
          ) {
            console.log(
              `[IconInjector] Found partial match: ${serviceName} -> ${availableIconName}`
            );
            return `${nodeId}["<img src='${url}' width='40' style='vertical-align: middle; margin-right: 8px; height: auto;'/>"]`;
          }
        }
      }

      console.warn(`[IconInjector] Icon not found for service: ${serviceName}`);
      return match; // Return original if no icon found
    });

    return processedCode;
  } catch (error) {
    console.warn('Failed to inject AWS icons from code:', error);
    return mermaidCode; // Return original code if injection fails
  }
};

/**
 * Synchronous version for backward compatibility - uses predefined icons
 */
export const injectAWSIconsFromCodeSync = (mermaidCode: string): string => {
  try {
    // Map of AWS service names to icon URLs (updated to use existing SVG files)
    const iconMap: Record<string, string> = {
      'storage-storage-s3': '/icons/aws/storage/storage-s3.svg',
      'compute-compute-ec2': '/icons/aws/compute/compute-ec2.svg',
      'compute-lambda': '/icons/aws/compute/lambda.svg',
      'database-database-rds': '/icons/aws/database/database-rds.svg',
      'database-database-dynamodb': '/icons/aws/database/database-dynamodb.svg',
      'database-aurora': '/icons/aws/database/aurora.svg',
      'networking-content-delivery-cloudfront':
        '/icons/aws/networking-content-delivery/network-cloudfront.svg',
      'networking-content-delivery-elb': '/icons/aws/networking-content-delivery/network-elb.svg',
      'app-integration-api-gateway': '/icons/aws/app-integration/api-gateway.svg',
      'security-identity-compliance-iam':
        '/icons/aws/security-identity-compliance/iam-identity-center.svg',
      'networking-content-delivery-vpc-lattice':
        '/icons/aws/networking-content-delivery/vpc-lattice.svg',
      'analytics-analytics-athena': '/icons/aws/analytics/analytics-athena.svg'
    };

    // Replace @{ icon: "aws:service" } syntax with actual icon HTML
    let processedCode = mermaidCode;

    // Match the pattern: nodeId@{ icon: "aws:service-name" }
    const iconPattern = /(\w+)@\{\s*icon:\s*["']aws:([^"']+)["']\s*}/g;

    processedCode = processedCode.replace(iconPattern, (match, nodeId, serviceName) => {
      const iconUrl = iconMap[serviceName];
      if (iconUrl) {
        // Replace with HTML image syntax with proper aspect ratio
        return `${nodeId}["<img src='${iconUrl}' width='40' style='vertical-align: middle; margin-right: 8px; height: auto;'/>"]`;
      }
      return match; // Return original if no icon found
    });

    return processedCode;
  } catch (error) {
    console.warn('Failed to inject AWS icons from code (sync):', error);
    return mermaidCode; // Return original code if injection fails
  }
};
